"use strict";

const utils = require("@iobroker/adapter-core");
const schedule = require("@iobroker/node-schedule-shim");

/*
const CognitoUserPool = require("amazon-cognito-identity-js");
const CognitoUser = require("amazon-cognito-identity-js");
const AuthenticationDetails = require("amazon-cognito-identity-js");
*/

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
		this.syncJob = null;
	}

	/**
	 * Executes the synchronization job for the adapter.
	 */
	async syncJobExecution() {
		/**
		 * login and create session
		 * iterate over isins and update their states accordingly
		 */
		this.log.info("Executing synchronization job");

		const isins = this.config.isinsTable;

		if (Array.isArray(isins) && isins.length > 0) {
			for (const row of isins) {
				// Access specific column values using the 'id' defined in jsonConfig
				this.log.info(`Processing row: ${row.isin}`);
			}
		}
	}

	/**
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
		//Basic checks
		if (!this.config.username || !this.config.password) {
			this.log.error("No credentials found please enter your credentials in the instance settings");
			return;
		}

		if (!this.config.syncTime) {
			this.log.error("No sync time found please enter the sync time in the instance settings");
			return;
		}

		try {
			this.syncJob = schedule.scheduleJob(this.config.syncTime, async () => {
				await this.syncJobExecution();
			});
		} catch (error) {
			this.log.error(`Error creating cron-job: ${error.message}`);
			return;
		}

		// Initialize states based on selected configuration
		const isins = this.config.isinsTable;

		if (Array.isArray(isins) && isins.length > 0) {
			for (const row of isins) {
				// Access specific column values using the 'id' defined in jsonConfig
				this.log.info(`Processing row: ${row.isin}`);

				// The only required state: Last price of the current ISIN
				await this.updateState(true, row.isin, "last", "number", "value");

				// Additional states for the current ISIN
				await this.updateState(this.config.isinEnabled, row.isin, "isin", "string", "text");
				await this.updateState(this.config.symbolEnabled, row.isin, "symbol", "string", "text");
				await this.updateState(this.config.nameEnabled, row.isin, "name", "string", "text");
				await this.updateState(this.config.currencyEnabled, row.isin, "currency", "string", "text");
				await this.updateState(this.config.countryEnabled, row.isin, "country", "string", "text");

				await this.updateState(this.config.highEnabled, row.isin, "high", "number", "value");
				await this.updateState(this.config.lowEnabled, row.isin, "low", "number", "value");
				await this.updateState(this.config.prevDayEnabled, row.isin, "prevDay", "number", "value");
				await this.updateState(this.config.performanceEnabled, row.isin, "performance", "number", "value");

				await this.updateState(this.config.w52CloseEnabled, row.isin, "w52Close", "number", "value");
				await this.updateState(this.config.w52HighEnabled, row.isin, "w52High", "number", "value");
				await this.updateState(this.config.w52HighDateEnabled, row.isin, "w52HighDate", "string", "date");
				await this.updateState(this.config.w52LowEnabled, row.isin, "w52Low", "number", "value");
				await this.updateState(this.config.w52LowDateEnabled, row.isin, "w52LowDate", "string", "date");
			}
		} else {
			this.log.info("The watch list table is empty.");
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
				schedule.cancelJob(this.syncJob);
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
