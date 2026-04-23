/**
 * @module token-client
 * @description Client library for interacting with the token lifecycle service.
 * Provides simple functions for token issuance, rotation, and validation.
 */

import { request } from "node:http";

const DEFAULT_TOKEN_SERVICE_URL = "http://127.0.0.1:18805";

/**
 * Make an HTTP request to the token service.
 * @param {string} method
 * @param {string} path
 * @param {Object} body
 * @param {string} authToken
 * @returns {Promise<Object>}
 */
function makeRequest(method, path, body = null, authToken = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, DEFAULT_TOKEN_SERVICE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: {
        "Content-Type": "application/json",
      },
    };

    if (authToken) {
      options.headers["Authorization"] = `Bearer ${authToken}`;
    }

    const req = request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            reject(new Error(parsed.error || `HTTP ${res.statusCode}`));
          }
        } catch (err) {
          reject(new Error(`Invalid JSON response: ${data}`));
        }
      });
    });

    req.on("error", reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

/**
 * Issue a new ephemeral token for a peer.
 * @param {string} masterToken - Master authentication token
 * @param {string} peerName - Name of the peer
 * @param {number} ttlHours - Token lifetime in hours (default: 24)
 * @returns {Promise<Object>} { token, expiresAt, peerName, issuedAt }
 */
export async function issueToken(masterToken, peerName, ttlHours = 24) {
  return makeRequest("POST", "/mesh/token/issue", { peerName, ttlHours }, masterToken);
}

/**
 * Rotate an existing ephemeral token.
 * @param {string} currentToken - Current valid ephemeral token
 * @returns {Promise<Object>} { token, expiresAt, peerName, issuedAt }
 */
export async function rotateToken(currentToken) {
  return makeRequest("POST", "/mesh/token/rotate", {}, currentToken);
}

/**
 * Revoke a token.
 * @param {string} masterToken - Master authentication token
 * @param {string} tokenToRevoke - Token to revoke
 * @returns {Promise<Object>} { ok, revoked }
 */
export async function revokeToken(masterToken, tokenToRevoke) {
  return makeRequest("POST", "/mesh/token/revoke", { token: tokenToRevoke }, masterToken);
}

/**
 * Validate a token.
 * @param {string} token - Token to validate
 * @returns {Promise<Object>} { valid, peerName?, expiresAt?, tokenType? }
 */
export async function validateToken(token) {
  return makeRequest("POST", "/mesh/token/validate", { token });
}

/**
 * Get token statistics.
 * @param {string} masterToken - Master authentication token
 * @returns {Promise<Object>} Token statistics
 */
export async function getTokenStats(masterToken) {
  return makeRequest("GET", "/mesh/token/stats", null, masterToken);
}

/**
 * Check if token service is healthy.
 * @returns {Promise<boolean>}
 */
export async function isHealthy() {
  try {
    await makeRequest("GET", "/health");
    return true;
  } catch {
    return false;
  }
}
