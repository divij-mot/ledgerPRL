import { addressToScript, parsePrl, type NetworkName } from "@pearl-ledger/sdk";
import {
  chainFor,
  hash,
  integer,
  object,
  parseChain,
  requireCondition,
  type Chain,
} from "./core.js";
import { parsePublicIntent, type PublicDappRequest } from "./broker.js";
import { LOCAL_SNAP_ID, SNAP_VERSION } from "./config.js";
export interface DappAccountGrant {
  grantId: string;
  address: string;
  chain: Chain;
  expiresAt: number;
  nextSequence: number;
}
interface Provider {
  request(args: { method: string; params?: unknown }): Promise<unknown>;
}
/** Explicit website integration. Existing eth_* dapps are not compatible without adding these PRL methods. */
export class PrlDappProvider {
  private grant: DappAccountGrant | null = null;
  private busy = false;
  constructor(private readonly ethereum: Provider) {}
  private call(method: string, params: unknown) {
    return this.ethereum.request({
      method: "wallet_invokeSnap",
      params: { snapId: LOCAL_SNAP_ID, request: { method, params } },
    });
  }
  private parseGrant(value: unknown, chain: Chain): DappAccountGrant {
    const g = object(
      value,
      ["grantId", "address", "chain", "expiresAt", "nextSequence"],
      "website account grant",
    );
    const received = parseChain(g.chain);
    requireCondition(
      received.network === chain.network &&
        received.genesisHash === chain.genesisHash &&
        typeof g.address === "string",
      "Wrong website account chain",
    );
    addressToScript(g.address, chain.network);
    return {
      grantId: hash(g.grantId),
      address: g.address,
      chain,
      expiresAt: integer(g.expiresAt),
      nextSequence: integer(g.nextSequence),
    };
  }
  /** Call only from an explicit connect action; MetaMask shows installation and address-consent prompts. */
  async requestAccounts(network: NetworkName): Promise<DappAccountGrant> {
    requireCondition(!this.busy, "Another website wallet request is active");
    this.busy = true;
    try {
      await this.ethereum.request({
        method: "wallet_requestSnaps",
        params: { [LOCAL_SNAP_ID]: { version: SNAP_VERSION } },
      });
      const chain = chainFor(network);
      this.grant = this.parseGrant(
        await this.call("prl_requestAccounts", { chain }),
        chain,
      );
      return { ...this.grant, chain: { ...chain } };
    } finally {
      this.busy = false;
    }
  }
  async requestPayment(
    recipient: string,
    amountPrl: string,
  ): Promise<PublicDappRequest> {
    requireCondition(
      !this.busy && this.grant,
      "Connect first and finish the active website request",
    );
    requireCondition(parsePrl(amountPrl) > 0n, "Expected positive amount");
    addressToScript(recipient, this.grant.chain.network);
    this.busy = true;
    try {
      const chain = this.grant.chain;
      this.grant = this.parseGrant(
        await this.call("prl_getAccounts", {
          grantId: this.grant.grantId,
          chain,
        }),
        chain,
      );
      const result = parsePublicIntent(
        await this.call("prl_requestPayment", {
          grantId: this.grant.grantId,
          chain,
          sequence: this.grant.nextSequence,
          recipient,
          amountPrl,
        }),
      );
      requireCondition(
        result.recipient === recipient &&
          parsePrl(result.amountPrl) === parsePrl(amountPrl) &&
          result.chain.network === chain.network &&
          result.chain.genesisHash === chain.genesisHash,
        "Website payment response changed",
      );
      return result;
    } finally {
      this.busy = false;
    }
  }
  async getRequest(
    id: string,
    network: NetworkName,
  ): Promise<PublicDappRequest> {
    return this.requestStatus("prl_getRequest", id, network);
  }
  async cancelRequest(
    id: string,
    network: NetworkName,
  ): Promise<PublicDappRequest> {
    return this.requestStatus("prl_cancelRequest", id, network);
  }
  private async requestStatus(
    method: string,
    id: string,
    network: NetworkName,
  ): Promise<PublicDappRequest> {
    const chain = chainFor(network),
      result = parsePublicIntent(
        await this.call(method, { id: hash(id), chain }),
      );
    requireCondition(
      result.id === id &&
        result.chain.network === network &&
        result.chain.genesisHash === chain.genesisHash,
      "Website status response changed",
    );
    return result;
  }
  async revokeAccounts(): Promise<void> {
    requireCondition(this.grant, "No website consent");
    const grant = this.grant;
    await this.call("prl_revokeAccounts", {
      grantId: grant.grantId,
      chain: grant.chain,
    });
    this.grant = null;
  }
}
