# PRL Ledger distribution and compatibility review

Reviewed 2026-10-09 UTC. Read-only source and official public documentation
research; documentation edits only. No compilation, native/emulator execution,
device access, installation, SDK modification, live wallet endpoint, submission,
credential handling or external contact occurred. The native lane remains paused.

## Decision

The repository is an experimental **device application**, with a separate USB
WebHID companion. It is not a Ledger OS image, an approved listing or a qualified
ordinary-user installation. Current source corrections have not been compiled
or executed. Neither Bitcoin's existing distribution nor previous Rust/emulator
results qualify this changed C application.

There is an additional admission question: Ledger's current getting-started
policy requires Rust for new device apps and retains C for existing-app
maintenance. Before treating this fork as a viable C submission, the owner needs
Ledger to confirm its classification and accepted implementation route. Do not
automatically rewrite the app, claim rejection, or claim an exception.
[Ledger getting started, updated September 30, 2026](https://developers.ledger.com/docs/device-app/getting-started).

## 1. The documented clone route does not establish PRL eligibility

The current clone guide's Bitcoin section is explicitly about a Layer-2 Bitcoin
application and points to `app-btcext-boilerplate`.
[Clone guide, updated September 1, 2026](https://developers.ledger.com/docs/device-app/integration/how-to/clone).
That boilerplate describes specialized Bitcoin transactions and exposes
validation/display and custom-signing hooks on the Bitcoin base.
[Official Bitcoin extension boilerplate](https://github.com/LedgerHQ/app-btcext-boilerplate).
The older `app-bitcoin-clone-boilerplate` is archived, dated March 13, 2026, and
directs Layer-2 work toward the newer extension boilerplate.
[Archived clone boilerplate](https://github.com/LedgerHQ/app-bitcoin-clone-boilerplate).

PRL's local `UPSTREAM.json`, Makefile and `src/prl.h` show a full fork of
`app-bitcoin` at `44ecd0410dcd6ca2f4728cf3c1b49800c30ca74a`, with separate-chain
genesis/HRP/coin type, different monetary limits and a restricted PRL policy.
It is not this documented extension example. **Inference:** the public clone
guide cannot be used as evidence that this particular new C project is exempt
from the Rust requirement. Whether Ledger would accept it as a maintained fork,
variant, exception or another category is a vendor decision, not something
source analysis can settle. No contact or form submission was made.

The VS Code guide still says it supports both C and Rust; that describes tool
capability and does not settle new-app admission. Its September 23 update also
predates the September 30 getting-started policy. Both facts should be retained
rather than interpreting tool support as publication permission.
[VS Code guide](https://developers.ledger.com/docs/device-app/beginner/vscode-extension).

## 2. Model, OS and API claims

The active C source declares unmodified secure SDK `v27.1.2`, commit
`6709cd2bdfebb224ee070f7c1211b54254262579`, API 27. The upstream Bitcoin 2.5.1
deployment tags recorded in `UPSTREAM.json` used SDK 26.6.2. The API-27 retarget
and PRL source changes are independent qualification obligations.

Official SDK `master` mapping observed on the review date:

| Device | C target | API-27 OS mapping | Current PRL physical qualification |
| --- | --- | --- | --- |
| Nano S Plus | `nanos2` | 1.7.0 | None |
| Nano X | `nanox` | 2.8.0 | None |
| Stax | `stax` | 1.11.0 | None |
| Flex | `flex` | 1.7.0 | None |
| Nano Gen5 | `apex_p` | 1.2.0 | None |

The SDK ties OS compatibility to API level and provides per-device OS tags;
its development `master` uses reserved API 0. The original Nano S uses a
separate LNS branch and is not supported by this PRL application. This table is
an SDK mapping, not a claim that the app has passed on those retail devices or
will run on any future firmware.
[Official SDK mapping and build targets](https://github.com/LedgerHQ/ledger-secure-sdk#about-api_level-branches).

The official Nano S Plus release notes independently list 1.7.0 as released
October 1, 2026. This bounded lookup did not establish current retail rollout or
owner eligibility for all five models; absence of matching search results for
the others is not proof of non-release.
[Nano S Plus release notes](https://support.ledger.com/pt-BR/article/4494540771997-zd).

Record the actual device model, OS/API, installed app version, release package
identity and browser/host OS in each future authorized hardware test. Recheck
the published mapping and retail eligibility at that time. Do not override API
metadata to make an incompatible package load.

The audit conditions page still names four models, while current Gen5 guidance
requires `apex_p`, target-specific icons, tests and app-database inclusion. Ask
Ledger to confirm the complete submission matrix, including Gen5, rather than
silently treating the four-model wording as a Gen5 exemption.
[Gen5 porting](https://developers.ledger.com/docs/device-app/explanation/gen5-porting),
[audit conditions](https://developers.ledger.com/docs/device-app/submission-process/deliverables/security-audit).

## 3. Installation and ordinary-user distribution are separate

Ledger's VS Code loading guide explicitly excludes Nano X sideloading. A retail
Nano X therefore cannot be treated like an ordinary custom-app sideload target;
the project needs a Ledger-controlled distribution/testing arrangement or an
explicitly suitable developer device. An emulator target and a special-device
host option are not retail workarounds. Other supported models still require
correct packages, compatible actual OS/API and separately approved installation.
[Official loading restrictions](https://developers.ledger.com/docs/device-app/beginner/vscode-extension).

Ledger's documented release flow uses its fork of the app repository, test
providers and a production catalog. A developer cannot self-certify that those
distribution steps have happened. Pearl has no established provider or catalog
deployment in the available evidence. Release also is not an endorsement.
[Deployment process](https://developers.ledger.com/docs/device-app/submission-process/process).

Normal use would require a correctly installed and opened PRL app, followed by
the companion's device connection and on-device review. The browser companion
does not install apps or update Ledger OS. No seed reset, recovery entry, custom
CA, generic test seed/PIN, warning bypass or provider change is a hidden
prerequisite. An OS update is a separate owner decision and must never be
bundled invisibly into app installation.

The existing pinned Rust sideload README links could not be re-fetched through
the public web tool in this review (cache miss). They remain historical
references; this report does not independently revalidate that installer or
reuse it as a C-port package qualification result.

## 4. Owner-controlled path to review and listing

1. Confirm the C-fork classification and accepted route with Ledger before
   commissioning expensive work or presenting a submission-ready architecture.
   Owner approval is needed for outreach and any private-source disclosure.
2. Select the project license; preserve upstream notices; freeze a candidate and
   qualify exact build/package provenance, permissions, all intended networks,
   models and actual retail OS versions. Resolve the currently paused native
   execution gate before making any native pass claim.
3. Fix the submission metadata/workflow mismatch: root `ledger_app.toml` still
   selects `./apps/ledger` and Rust, while the C manifest is nested. Ledger
   requires a correct repository-root manifest, green guidelines/build
   workflows and automated functional tests. Ragger is documented as an option
   for Python tests, not a claim that these TypeScript tests are already
   accepted. [Development requirements](https://developers.ledger.com/docs/device-app/integration/requirements/development).
4. Obtain Ledger functional validation and confirm the required model matrix;
   only then commission the required approved-partner security audit. The owner
   approves its cost, contract and disclosure. The specified audit includes
   human review; AI review complements it. Resolve findings and let Ledger
   review the report. [Security audit](https://developers.ledger.com/docs/device-app/submission-process/deliverables/security-audit).
5. Prepare source/CI evidence, icons, companion, documentation, support details
   and demonstration materials; obtain explicit owner approval for submission,
   publication and applicable terms. The official process controls release.
   [Submission process](https://developers.ledger.com/docs/device-app/submission-process/process).

A My Ledger **device-app listing** can support a third-party companion.
First-class **Pearl asset management inside Ledger Wallet** is a separate
integration/commercial path; listing alone does not supply balances, accounts,
sending or other Ledger Wallet asset features.
[Integration paths](https://developers.ledger.com/docs/device-app/getting-started).

## 5. Transport and browser boundary

Local production source registers only `webHidTransportFactory`; the C Makefile
sets `ENABLE_BLUETOOTH = 0`. Thus this project is USB-only even when the physical
model has Bluetooth. There is no MetaMask requirement, mobile bridge or
Bluetooth fallback. Desktop Chrome/Edge on HTTPS or loopback are intended test
targets; Safari, Firefox and mobile are not qualified. Rendering the website on
a phone is not proof that the phone can connect to its signer.

Ledger's DMK setup states that the browser must support WebHID, and its migration
guide treats WebHID, Web BLE and other transports as distinct integrations.
[DMK setup](https://developers.ledger.com/docs/device-interaction/dmk-ts/beginner/setup),
[transport migration](https://developers.ledger.com/docs/device-interaction/dmk-ts/integration/migrations/ledgerjs-to-dmk).
Chrome's WebHID documentation describes explicit device access and notes that
Linux permissions may need configuration. That does not authorize changing USB
or system security settings in this review.
[Chrome WebHID](https://developer.chrome.com/docs/capabilities/hid).

HTTPS protects delivery in transit; it does not prove app installation,
on-device review, a safe frontend or a qualified device. Public TLS deployment
and actual browser-to-Ledger behavior remain separate acceptance tests.

## 6. A standard version response is not source attestation

The C Makefile currently uses `0.1.0-prl-dev` for all source revisions. Its SDK
default version handler reads the installed app name/version tags and OS flags;
it does not return a fresh, signed statement of the app's source or binary hash.
The relevant inspected source is
`apps/ledger/vendor/ledger-secure-sdk/io/src/os_io_default_apdu.c:60-103`.
[Pinned official SDK handler](https://github.com/LedgerHQ/ledger-secure-sdk/blob/6709cd2bdfebb224ee070f7c1211b54254262579/io/src/os_io_default_apdu.c).
The DMK's standard command exposes the app name and version.
[DMK app information](https://developers.ledger.com/docs/device-interaction/dmk-ts/beginner/exchange_data).

The PRL host currently checks its exact public network/profile tuple on each
operation, but does not enforce an app release version. Those fields contain no
source hash, certificate, challenge or attestation signature. See the existing
[identity review](../device-identity-review/REPORT.md), current adapter
`src/client.ts`/`src/policy.ts`, and native `get_network_info.c`.

**Inference from the protocol/source:** adding a strict name/version check can
reject accidental mismatches or explicitly retired version labels, but cannot
distinguish older patched/unpatched builds sharing `0.1.0-prl-dev`, or prove
which source produced a matching response. A future release process should use
unique versions and exact reviewed artifact hashes tied to trusted distribution.
Even a reported build hash alone would be a self-assertion. Do not describe this
standard check as firmware authentication, patched-source proof, certification
or a substitute for Ledger's distribution controls. No code was changed here.

## Documentation corrections made

- Root README: explicit pending C-route decision, USB-only transport, current
  source/model qualification limits and a link to this review.
- `docs/firmware.md`: clear separation of current C status from historical Rust
  evidence; model/API mapping caveat, admission question and USB-only scope.
- `docs/submission-checklist.md`: admission/classification gate, final-source
  qualification wording, USB/browser coverage and truthful version-check limits.
- `docs/website-hosting.md`: concise USB/browser and preinstalled-app boundary.

The archived Rust SDK patches, app names, package flags and 25-build matrix are
not inherited by the C app. The top-level manifest remains unchanged until a
deliberate submission-layout decision. The current C Makefile's explicit
global-PIN privilege and other effective package permissions still require
their own review; this report does not approve them.

`source-observations.json` binds inspected local inputs and changed documents.
Validation was limited to reading the resulting Markdown, checking links against
the retrieved official pages and `git diff --check`; no code or native tests ran.
