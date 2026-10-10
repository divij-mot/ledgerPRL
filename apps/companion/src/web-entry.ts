import { configureDevice } from "./device.js";
import { connectLedger } from "./ledger.js";

configureDevice("web", connectLedger);
void import("./main.js");
