const fs = require("node:fs");
const path = require("node:path");

const {
    CognitoUserPool,
    CognitoUser,
    AuthenticationDetails,
} = require("amazon-cognito-identity-js");

const ISINS = [
    "DE0005810055",
    "FR001400YYJ0",
];

//https://mein.finanzen-zero.net/api/instrument/detail/FR0010717090

/**
	 * Retrieve JWT token for the specified username and password
	 *
	 * @param {string} username - The username for authentication
	 * @param {string} password - The password for authentication
	 * @returns {Promise<string>} - The JWT token for the authenticated session
	 */
async function login(username, password) {
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
            onSuccess: (session) => resolve(session.getIdToken()),
            onFailure: (err) => reject(new Error(err.message || String(err))),
        });
    });

    // exp is a Unix timestamp (seconds); Cognito id tokens are valid for 1 hour by default.
    const expires = session.getExpiration();
    console.log(`Session token valid until ${new Date(expires * 1000).toLocaleString()}`);

    return session.getJwtToken();
}

/**
 * Probe the API to check if the specified instrument is accessible and has valid data
 *
 * @param {string} token - The JWT token for authentication
 * @param {string} isin - The ISIN identifier for the instrument
 * @returns {Promise<boolean>} - True if the probe was successful, false otherwise
 */
async function probe(token, isin){
    const detail = await getData(token, isin);

    //{"type":"apiError","status":"UNAUTHORIZED","message":"Full authentication is required to access this resource","errors":[]}
    if (detail && typeof detail === "object" && "message" in detail) {
        throw new Error(String(detail.message));
    }

    //{"name": "Amundi","isin": "FR0010717090","last": 211.4}
    if (detail && typeof detail === "object" && "last" in detail) {
        return true;
    }

    return false;
}

/**
 * Query the API to retrieve detailed data for the specified instrument
 *
 * @param {string} token - The JWT token for authentication
 * @param {string} isin - The ISIN identifier for the instrument
 * @returns {Promise<object>} - The detailed data for the specified instrument
 */
async function getData(token, isin) {
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

async function main() {
    try {
        const { username: USER, password: PASS } = require("./secrets.json");
        const session = await login(USER, PASS);
        const probeResult = await probe(session, "DE0005810055");

        if (probeResult) {
            console.log(`Probe successful for DE0005810055`);


            const results = [];
            for (const isin of ISINS) {
                const detail = await getData(session, isin);
                console.log(`Found ${detail.isin} ${detail.name}`);
                results.push(detail);
            }

            fs.writeFileSync(
                path.join(__dirname, "watchlist.json"),
                JSON.stringify(results, null, 4),
                { encoding: "utf-8" }
            );
        }
    } catch (err) {
        console.error(err.stack || String(err));
        process.exit(1);
    }
}

main();
