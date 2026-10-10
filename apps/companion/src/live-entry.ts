import { configureDevice } from "./device.js";
import { connectWalletLedger } from "./wallet-api.js";

configureDevice("wallet", connectWalletLedger);
void import("./main.js");
