/** Development-only exact origins. Changing these requires rebuilding and permission review. */
export const COMPANION_ORIGINS = Object.freeze([
  "http://127.0.0.1:5173",
  "http://localhost:5173",
]);
export const LOCAL_SNAP_ID = "local:http://127.0.0.1:8087";
export const SNAP_VERSION = "0.1.0";
export const SESSION_TTL_MS = 15 * 60_000;
export const REQUEST_TTL_MS = 3 * 60_000;
export const MAX_RPC_BYTES = 24_000;
export const MAX_REQUESTS_PER_SESSION = 100;
export const MAX_ADDRESS_INDEX = 999;
export const DAPP_ORIGINS = Object.freeze(["http://127.0.0.1:4173"]);
export const ALLOWED_ORIGINS = Object.freeze([
  ...COMPANION_ORIGINS,
  ...DAPP_ORIGINS,
]);
