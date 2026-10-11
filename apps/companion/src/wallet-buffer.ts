import { Buffer } from "buffer";

// Wallet API's transitive codecs access Buffer during module evaluation.
// This side-effect import must run before importing the official client.
(globalThis as typeof globalThis & { Buffer: typeof Buffer }).Buffer ??= Buffer;
