import { PrlDappProvider } from "../src/dapp.js";
import type { NetworkName } from "@pearl-ledger/sdk";
import type { PublicDappRequest } from "../src/broker.js";
const find = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const buttons = ["connect", "request", "refresh", "cancel"].map((id) =>
  find<HTMLButtonElement>(id),
);
let wallet: PrlDappProvider | null = null;
let payment: PublicDappRequest | null = null;
let connectedNetwork: NetworkName | null = null;
function render() {
  find<HTMLButtonElement>("request").disabled = !connectedNetwork;
  find<HTMLButtonElement>("refresh").disabled = !payment;
  find<HTMLButtonElement>("cancel").disabled =
    !payment || !["queued", "claimed", "prepared"].includes(payment.status);
  find<HTMLSelectElement>("network").disabled = !!connectedNetwork;
  if (payment)
    find("status").textContent =
      `Request: ${payment.id}\nWebsite: ${payment.origin}\nStatus: ${payment.status}\nRecipient: ${payment.recipient}\nAmount: ${payment.amountPrl} PRL\nTransaction: ${payment.txid ?? "not signed"}\nBroadcast: ${payment.broadcast}`;
}
async function action(run: () => Promise<void>) {
  buttons.forEach((button) => (button.disabled = true));
  find("error").textContent = "";
  try {
    await run();
  } catch (error) {
    find("error").textContent =
      error instanceof Error ? error.message : "Wallet request failed";
  } finally {
    find<HTMLButtonElement>("connect").disabled = false;
    render();
  }
}
find("connect").onclick = () =>
  void action(async () => {
    const ethereum = (
      window as unknown as {
        ethereum?: {
          request(args: { method: string; params?: unknown }): Promise<unknown>;
        };
      }
    ).ethereum;
    if (!ethereum)
      throw new Error(
        "MetaMask Flask is not available in this browser. No substitute wallet or hardware connection is simulated.",
      );
    wallet = new PrlDappProvider(ethereum);
    const network = find<HTMLSelectElement>("network").value as NetworkName;
    const account = await wallet.requestAccounts(network);
    connectedNetwork = network;
    find("account").textContent =
      `${account.chain.network}: ${account.address}`;
  });
find("request").onclick = () =>
  void action(async () => {
    if (!wallet) throw new Error("Connect first");
    payment = await wallet.requestPayment(
      find<HTMLInputElement>("recipient").value.trim(),
      find<HTMLInputElement>("amount").value.trim(),
    );
  });
find("refresh").onclick = () =>
  void action(async () => {
    if (!wallet || !payment) return;
    payment = await wallet.getRequest(payment.id, payment.chain.network);
  });
find("cancel").onclick = () =>
  void action(async () => {
    if (!wallet || !payment) return;
    payment = await wallet.cancelRequest(payment.id, payment.chain.network);
  });
