"use strict";

const path = require("path");
const utils = require("@iobroker/adapter-core");
const schedule = require("node-schedule");

const { I18n } = utils;
const { CognitoUserPool, CognitoUser, AuthenticationDetails } = require("amazon-cognito-identity-js");

class Portfolio extends utils.Adapter {
	/**
	 * @param {Partial<utils.AdapterOptions>} [options] - Adapter options
	 */
	constructor(options) {
		super({
			...options,
			name: "portfolio",
		});
		this.on("ready", this.onReady.bind(this));
		this.on("unload", this.onUnload.bind(this));
		this.dailyJob = null;
		this.syncJob = null;
	}

	/**
	 * Executes the daily job for the adapter.
	 */
	async dailyJobExecution() {
		// Reset message flags for daily notifications
		this.limitHighSent = false;
		this.limitLowSent = false;
		this.averageHighSent = false;
		this.averageLowSent = false;
		this.regressionHighSent = false;
		this.regressionLowSent = false;
	}

	/**
	 * Executes the synchronization job for the adapter.
	 */
	async syncJobExecution() {
		try {
			const isins = this.config.isinsTable;

			if (Array.isArray(isins) && isins.length > 0) {
				const session = await this.getToken(this.config.username, this.config.password);

				for (const row of isins) {
					try {
						this.log.debug(`${row.isin} fetch data`);
						const data = await this.getData(session, row.isin);
						await this.writeState(this.config.lastChk, row.isin, "last", data.last);

						await this.writeState(this.config.isinChk, row.isin, "isin", data.isin);
						await this.writeState(this.config.symbolChk, row.isin, "symbol", data.symbol);
						await this.writeState(this.config.nameChk, row.isin, "name", data.name);
						await this.writeState(this.config.currencyChk, row.isin, "currency", data.currency);
						await this.writeState(this.config.countryChk, row.isin, "country", data.country);

						await this.writeState(this.config.highChk, row.isin, "high", data.high);
						await this.writeState(this.config.lowChk, row.isin, "low", data.low);
						await this.writeState(this.config.prevDayChk, row.isin, "prevDay", data.prevDay);
						await this.writeState(this.config.performanceChk, row.isin, "performance", data.performance);

						await this.writeState(this.config.w52CloseChk, row.isin, "w52Close", data.w52Close);
						await this.writeState(this.config.w52HighChk, row.isin, "w52High", data.w52High);
						await this.writeState(this.config.w52HighDateChk, row.isin, "w52HighDate", data.w52HighDate);
						await this.writeState(this.config.w52LowChk, row.isin, "w52Low", data.w52Low);
						await this.writeState(this.config.w52LowDateChk, row.isin, "w52LowDate", data.w52LowDate);

						const metrics = await this.historyCalculation(row.isin, "last");
						this.log.debug(`${row.isin}: regression=${metrics.regression}, average=${metrics.average}`);
						await this.writeState(this.config.regressionChk, row.isin, "regression", metrics.regression);
						await this.writeState(this.config.averageChk, row.isin, "average", metrics.average);

						await this.checkLimits(row);
					} catch (error) {
						this.log.error(`${row.isin} Error processing data: ${error.message}`);
					}
				}
			}
		} catch (error) {
			this.log.error(error.message);
		}
	}

	/**
	 * Calculate metrics (according to the configured options) using historical data
	 *
	 * @param {string} isin - The ISIN identifier for the instrument
	 * @param {string} state - The state object containing relevant information
	 * @returns {Promise<{ regression: number, average: number }>} The calculated metrics based on historical data
	 */
	async historyCalculation(isin, state) {
		const defaultResult = { regression: 0, average: 0 };

		if (!this.config.historyInstance) {
			return defaultResult;
		}

		if (!this.config.regressionChk && this.config.averageChk) {
			return defaultResult;
		}

		const endTime = new Date().getTime();
		const startTime = new Date(Date.now() - 86400000 * this.config.historyDays).getTime();

		const response = await this.sendToAsync(this.config.historyInstance, "getHistory", {
			id: `${this.namespace}.${isin}.${state}`,
			options: {
				start: startTime,
				end: endTime,
				aggregate: "none",
				removeBorderValues: true,
			},
		});

		if (!response || typeof response !== "object" || !("result" in response) || !Array.isArray(response.result)) {
			this.log.error(`${isin} Error fetching history: Invalid response`);
			return defaultResult;
		}

		const history = response.result;
		this.log.debug(`${isin} calculation based on history length: ${history.length}`);
		const regression = await this.calculateRegression(this.config.regressionChk, history);
		const average = await this.calculateAverage(this.config.averageChk, history);

		return { regression, average };
	}

	/**
	 * Calculate the regression based on the historical values
	 *
	 * @param {boolean} enabled - Indicates whether the state should be enabled or not
	 * @param {Array} history - The historical data for the instrument
	 * @returns {Promise<number>} The calculated regression as a percentage slope from the historical data
	 */
	async calculateRegression(enabled, history) {
		if (!enabled && (!history || history.length === 0)) {
			return 0;
		}
		const n = history.length;

		let sumX = 0;
		let sumY = 0;
		let sumXY = 0;
		let sumX2 = 0;

		// Calculate the sums for the regression formula, x represents the time step and y represents the stock price
		for (let i = 0; i < n; i++) {
			const x = i;
			const y = history[i].val;

			sumX += x;
			sumY += y;
			sumXY += x * y;
			sumX2 += x * x;
		}

		// Calculate the slope (m) of the linear regression:
		// Formular: m = (n * sum(xy) - sum(x) * sum(y)) / (n * sum(x^2) - (sum(x))^2)
		const numerator = n * sumXY - sumX * sumY;
		const denominator = n * sumX2 - sumX * sumX;

		const absolute = denominator === 0 ? 0 : numerator / denominator; //case when all x-values are identical (should not happen with time steps)
		const last = history[history.length - 1].val; // Last (current) value
		this.log.debug(`Last (current) value is ${last}, absolute slope is ${absolute}`);

		if (last === 0) {
			this.log.debug("The current value is zero, cannot calculate percentage slope.");
			return 0;
		}

		const percentage = (absolute / last) * 100;
		return Math.round(percentage * 1000) / 1000;
	}

	/**
	 * Calculate the average based on the historical values
	 *
	 * @param {boolean} enabled - Indicates whether the state should be enabled or not
	 * @param {Array} history - The historical data for the instrument
	 * @returns {Promise<number>} The calculated average as a percentage deviation from the current value
	 */
	async calculateAverage(enabled, history) {
		if (!enabled && (!history || history.length === 0)) {
			return 0;
		}
		const sum = history.reduce((acc, price) => acc + price.val, 0); // Sum of all valuess
		const absolute = sum / history.length; // Absolute SMA (average)
		const last = history[history.length - 1].val; // Last (current) value
		this.log.debug(`Last (current) value is ${last}, absolute average is ${absolute}`);

		if (last === 0) {
			this.log.debug("The current value is zero, cannot calculate percentage deviation.");
			return 0;
		}

		const percentage = ((last - absolute) / last) * 100; // Percentage deviation from the current value
		return Math.round(percentage * 1000) / 1000;
	}

	/**
	 * Check the configured limits and send notifications if necessary
	 *
	 * @param {{ isin: string, limitHigh: number, limitLow: number, regressionHigh: number, regressionLow: number, averageHigh: number, averageLow: number }} limits - The configured limits (row of isinsTable)
	 */
	async checkLimits(limits) {
		if (!this.config.messageInstance) {
			return;
		}

		if (this.config.limitHighChk || this.config.limitLowChk) {
			const state = await this.getStateAsync(`${limits.isin}.last`);
			if (state && state.val !== null && state.val !== undefined) {
				const value = Number(state.val);
				this.log.debug(`${limits.isin} Checking limits, value: ${value}`);

				if (!this.limitHighSent && limits.limitHigh !== 0 && value > limits.limitHigh) {
					await this.sendNotification(limits.isin, "lblLimitHigh");
					this.limitHighSent = true;
				}
				if (!this.limitLowSent && limits.limitLow !== 0 && value < limits.limitLow) {
					await this.sendNotification(limits.isin, "lblLimitLow");
					this.limitLowSent = true;
				}
			}
		}

		if (this.config.regressionHighChk || this.config.regressionLowChk) {
			const state = await this.getStateAsync(`${limits.isin}.regression`);
			if (state && state.val !== null && state.val !== undefined) {
				const value = Number(state.val);
				this.log.debug(`${limits.isin} Checking regression, value: ${value}`);

				if (!this.regressionHighSent && limits.regressionHigh !== 0 && value > limits.regressionHigh) {
					await this.sendNotification(limits.isin, "lblRegressionHigh");
					this.regressionHighSent = true;
				}
				if (!this.regressionLowSent && limits.regressionLow !== 0 && value < limits.regressionLow) {
					await this.sendNotification(limits.isin, "lblRegressionLow");
					this.regressionLowSent = true;
				}
			}
		}

		if (this.config.averageHighChk || this.config.averageLowChk) {
			const state = await this.getStateAsync(`${limits.isin}.average`);
			if (state && state.val !== null && state.val !== undefined) {
				const value = Number(state.val);
				this.log.debug(`${limits.isin} Checking average, value: ${value}`);

				if (!this.averageHighSent && limits.averageHigh !== 0 && value > limits.averageHigh) {
					await this.sendNotification(limits.isin, "lblAverageHigh");
					this.averageHighSent = true;
				}
				if (!this.averageLowSent && limits.averageLow !== 0 && value < limits.averageLow) {
					await this.sendNotification(limits.isin, "lblAverageLow");
					this.averageLowSent = true;
				}
			}
		}
	}

	/**
	 * Send notifications using the configured notification instance
	 *
	 * @param {string} isin - The ISIN identifier for the instrument
	 * @param {string} limit - The limit that triggered the notification
	 */
	async sendNotification(isin, limit) {
		if (!this.config.messageInstance) {
			return;
		}

		const adapterType = this.config.messageInstance.split(".")[0];
		let action = "send";
		let payload = {};

		const message = `${isin} ${I18n.t("lblMessageText")}: ${I18n.t(limit)}`;
		this.log.debug(`${isin} Sending [${adapterType}] ${message}`);

		switch (adapterType) {
			case "email":
				action = "send";
				payload = {
					text: message,
					subject: isin,
				};
				break;
			case "pushover":
				action = "send";
				payload = {
					message: message,
					title: isin,
					...(this.config.messageSound ? { sound: this.config.messageSound } : {}),
				};
				break;
			case "pushsafer":
				action = "send";
				payload = {
					message: message,
					title: isin,
					...(this.config.messageSound ? { sound: this.config.messageSound } : {}),
				};
				break;
			case "telegram":
				action = "send";
				payload = {
					text: `${isin} ${message}`,
				};
				break;
			case "signal-cmb":
				action = "send";
				payload = `${isin} ${message}`;
				break;
			case "whatsapp-cmb":
				action = "send";
				payload = `${isin} ${message}`;
				break;
		}

		const response = await this.sendToAsync(this.config.messageInstance, action, payload);

		if (response && typeof response === "object" && "error" in response && response.error) {
			this.log.error(`${isin} Error sending notification [${this.config.messageInstance}] ${response.error}`);
		}
	}

	/**
	 * Query the API to retrieve detailed data for the specified instrument
	 *
	 * @param {string} token - The JWT token for authentication
	 * @param {string} isin - The ISIN identifier for the instrument
	 * @returns {Promise<object>} - The detailed data for the specified instrument
	 */
	async getData(token, isin) {
		const url = new URL(`/api/instrument/detail/${isin}`, "https://mein.finanzen-zero.net");
		const result = await fetch(url, {
			headers: { "X-GB-Authorization": token },
		});

		if (result.status === 403) {
			const res = await result.json();
			if (res && typeof res === "object" && "status" in res && "message" in res) {
				throw new Error(String(res.message));
			} else {
				throw new Error(JSON.stringify(res));
			}
		}

		if (!result.ok) {
			throw new Error(await result.text());
		}

		return result.json();
	}

	/**
	 * Retrieve JWT token for the specified username and password
	 *
	 * @param {string} username - The username for authentication
	 * @param {string} password - The password for authentication
	 * @returns {Promise<string>} - The JWT token for the authenticated session
	 */
	async getToken(username, password) {
		// AWS Cognito (Amplify) config of finanzen.net zero, taken from the web app config.
		const pool = new CognitoUserPool({
			UserPoolId: "eu-central-1_W7ZDh3Al1",
			ClientId: "6hcbp28i4mvooqt0edcq5u284s",
		});

		const cognitoUser = new CognitoUser({ Username: username, Pool: pool });
		const authDetails = new AuthenticationDetails({
			Username: username,
			Password: password,
		});

		const session = await new Promise((resolve, reject) => {
			cognitoUser.authenticateUser(authDetails, {
				onSuccess: session => resolve(session.getIdToken().getJwtToken()),
				onFailure: err => reject(new Error(err.message || String(err))),
			});
		});

		return session;
	}

	/**
	 * Enable history tracking for the specified state in the configuration
	 *
	 * @param {string} isin - The ISIN identifier for the state
	 * @param {string} state - The state object containing relevant information
	 */
	async enableHistory(isin, state) {
		const obj = await this.getObjectAsync(`${isin}.${state}`);

		if (obj && obj.common) {
			if (!obj.common.custom || !obj.common.custom[this.config.historyInstance]) {
				await this.extendObject(`${isin}.${state}`, {
					common: {
						custom: {
							[`${this.config.historyInstance}`]: {
								enabled: true,
								changesOnly: true,
								debounce: 0,
							},
						},
					},
				});
			}
		}
	}

	/**
	 * Write state value if it is enabled in the configuration
	 *
	 * @param {boolean} enabled - Indicates whether the state should be enabled or not
	 * @param {string} isin - The ISIN identifier for the state
	 * @param {string} state - The state object containing relevant information
	 * @param {string | number} value - The value to be written to the state
	 */
	async writeState(enabled, isin, state, value) {
		if (enabled) {
			if (value === 0 || value === "") {
				this.log.debug(`${isin} Skipping write of "${state}", value is empty (0 or "")`);
				return;
			}
			await this.setState(`${isin}.${state}`, value, true);
		}
	}

	/**
	 * Create or delete state based on whether it is enabled or not in configuration
	 *
	 * @param {boolean} enabled - Indicates whether the state should be enabled or not
	 * @param {string} isin - The ISIN identifier for the state
	 * @param {string} state - The state object containing relevant information
	 * @param {ioBroker.CommonType} type - The data type of the state (e.g., "number", "string")
	 * @param {string} role - The role of the state (e.g., "value", "indicator")
	 */
	async updateState(enabled, isin, state, type, role) {
		if (enabled) {
			await this.setObjectNotExistsAsync(`${isin}.${state}`, {
				type: "state",
				common: {
					name: state,
					type: type,
					role: role,
					read: true,
					write: true,
				},
				native: {},
			});
		} else {
			await this.delObjectAsync(`${isin}.${state}`);
		}
	}

	/**
	 * Is called when databases are connected and adapter received configuration.
	 */
	async onReady() {
		await I18n.init(path.join(__dirname, "admin"), this);

		//Basic checks
		if (!this.config.username || !this.config.password) {
			this.log.warn("No credentials found please enter your credentials in the instance settings");
			return;
		}

		if (!this.config.syncTime || this.config.syncTime.trim() === "") {
			this.log.warn("No sync time found please enter the sync time in the instance settings");
			return;
		}

		try {
			this.dailyJob = schedule.scheduleJob("10 13 * * *", async () => {
				await this.dailyJobExecution();
			});
		} catch (error) {
			this.log.error(`Error creating daily-job: ${error.message}`);
			return;
		}

		try {
			this.syncJob = schedule.scheduleJob(this.config.syncTime, async () => {
				await this.syncJobExecution();
			});
		} catch (error) {
			this.log.error(`Error creating sync-job: ${error.message}`);
			return;
		}

		// Initialize states based on selected configuration
		const isins = this.config.isinsTable;

		if (Array.isArray(isins) && isins.length > 0) {
			for (const row of isins) {
				// The only required state: Last price of the current ISIN
				await this.updateState(true, row.isin, "last", "number", "value");
				if (this.config.historyInstance) {
					// Enable history for the "last" state if history instance is configured
					await this.enableHistory(row.isin, "last");
				}

				// Additional states for the current ISIN
				await this.updateState(this.config.isinChk, row.isin, "isin", "string", "text");
				await this.updateState(this.config.symbolChk, row.isin, "symbol", "string", "text");
				await this.updateState(this.config.nameChk, row.isin, "name", "string", "text");
				await this.updateState(this.config.currencyChk, row.isin, "currency", "string", "text");
				await this.updateState(this.config.countryChk, row.isin, "country", "string", "text");

				await this.updateState(this.config.highChk, row.isin, "high", "number", "value");
				await this.updateState(this.config.lowChk, row.isin, "low", "number", "value");
				await this.updateState(this.config.prevDayChk, row.isin, "prevDay", "number", "value");
				await this.updateState(this.config.performanceChk, row.isin, "performance", "number", "value");

				await this.updateState(this.config.w52CloseChk, row.isin, "w52Close", "number", "value");
				await this.updateState(this.config.w52HighChk, row.isin, "w52High", "number", "value");
				await this.updateState(this.config.w52HighDateChk, row.isin, "w52HighDate", "string", "date");
				await this.updateState(this.config.w52LowChk, row.isin, "w52Low", "number", "value");
				await this.updateState(this.config.w52LowDateChk, row.isin, "w52LowDate", "string", "date");

				await this.updateState(this.config.regressionChk, row.isin, "regression", "number", "value");
				await this.updateState(this.config.averageChk, row.isin, "average", "number", "value");
			}
		} else {
			this.log.info("The watch list is empty.");
		}
		if (this.log.level === "debug") {
			this.log.debug("Starting initial synchronization...");
			await this.syncJobExecution();
		}
	}

	/**
	 * Is called when adapter shuts down - callback has to be called under any circumstances!
	 *
	 * @param {() => void} callback - Callback function
	 */
	onUnload(callback) {
		try {
			if (this.syncJob) {
				this.syncJob.cancel();
			}

			callback();
		} catch (error) {
			this.log.error(`Error during unloading: ${error.message}`);
			callback();
		}
	}
}

if (require.main !== module) {
	// Export the constructor in compact mode
	/**
	 * @param {Partial<utils.AdapterOptions>} [options] - Adapter options
	 */
	module.exports = options => new Portfolio(options);
} else {
	// otherwise start the instance directly
	new Portfolio();
}
