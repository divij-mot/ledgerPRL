import { Button } from "@ledgerhq/lumen-ui-react";
import { renderToStaticMarkup } from "react-dom/server.edge";

export type WalletPage = "overview" | "receive" | "send" | "activity";
const pages: Record<WalletPage, string> = {
  overview: "Portfolio",
  receive: "Receive",
  send: "Send",
  activity: "Activity",
};

/** Lumen is presentation only; the existing wallet owns actions and state. */
export function walletShell(options: {
  page: WalletPage;
  network: string;
  busy: boolean;
  settings: string;
  content: string;
}): string {
  const { page, network, busy, settings, content } = options;
  // Account header / balance / actions / operations follow Ledger Wallet's
  // renderer/screens/account composition; the host already supplies its shell.
  return renderToStaticMarkup(
    <div className="layout dark">
      <main className="main">
        <header className="topbar">
          <div>
            <p className="asset-ticker">PRL</p>
            <h1>
              {page === "overview" || page === "activity"
                ? "Pearl"
                : pages[page]}
            </h1>
          </div>
          <div className="account-tools">
            <span className="network-label">{network}</span>
            <div dangerouslySetInnerHTML={{ __html: settings }} />
          </div>
        </header>
        <nav className="nav" aria-label="Account navigation">
          {(["overview", "activity"] as const).map((key) => (
            <button
              key={key}
              data-nav={key}
              className={page === key ? "active" : ""}
              aria-current={page === key ? "page" : undefined}
              disabled={busy}
            >
              {pages[key]}
            </button>
          ))}
        </nav>
        <div
          className="wallet-content"
          dangerouslySetInnerHTML={{ __html: content }}
        />
      </main>
    </div>,
  ).replaceAll('disabled=""', "disabled");
}

export function walletButton(
  id: string,
  label: string,
  disabled = false,
): string {
  return renderToStaticMarkup(
    <Button
      id={id}
      data-slot="lumen-button"
      className="account-button"
      appearance="accent"
      disabled={disabled}
    >
      {label}
    </Button>,
  ).replaceAll('disabled=""', "disabled");
}
