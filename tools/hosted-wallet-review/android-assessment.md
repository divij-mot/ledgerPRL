# Android verification feasibility

Read-only assessment, 2026-10-10. No SDK, emulator, APK or large payload was downloaded; no tool was installed and no licence accepted. **The user subsequently declined native Android/SDK work.** The options below are retained as investigation evidence only; SDK installation is not part of the active delivery scope.

## Current machine

`adb` 37.0.0 is installed at `/opt/homebrew/bin/adb`. JDK 21 installations are present. No `android`, `sdkmanager`, `avdmanager`, emulator executable, SDK at the normal user location or configured AVD was found. Existing Android user keys/settings were not opened or modified.

## Official Ledger 4.23.0 APK

Ledger's [mobile 4.23.0 release](https://github.com/LedgerHQ/ledger-live/releases/tag/live-mobile%404.23.0) exists at commit `abed962b08ca4b746f20192b28ce5b6c06a6c6a4`, published 2026-10-02. The official release API returned an empty binary-assets list. All 12 public Actions runs for that exact commit and their retained artifact lists were inspected: no APK/build/app-package artifact was advertised; the relevant prerelease workflow was cancelled without artifacts. This establishes no currently identified public matching APK, not that Ledger never produced one. Evidence: `android-official-metadata.json` and `android-official-artifacts.json`.

The [official repository](https://github.com/LedgerHQ/ledger-live) describes APKs attached to CI builds and other distribution channels restricted to authorized users. A later verified official CI artifact, an official Play installation, or a local build of the pinned official source are acceptable alternatives. An unofficial APK mirror is not needed or recommended. Installing from Play may require user-controlled sign-in and does not by itself pin the result to version 4.23.0.

## Smallest useful emulator path

For a **scoped Android WebView harness**, use an isolated SDK/AVD directory under ignored task tooling, official Android command-line tooling, the macOS ARM64-compatible emulator, and `system-images;android-36;google_apis;arm64-v8a`. The existing `adb` can communicate with a specifically selected emulator. Compiling a tiny Java WebView harness additionally needs `platforms;android-36` and `build-tools;36.0.0`; the existing JDK 21 can supply Java compilation/signing tools. A small harness can use AAPT2/D8/apksigner directly, so a full Android Studio installation, React Native dependency tree, NDK and Gradle are not inherently required. This is the proposed smallest useful path, not an already executed build. [Android package manager](https://developer.android.com/tools/sdkmanager), [AVD documentation](https://developer.android.com/studio/run/managing-avds), [build tools](https://developer.android.com/tools/aapt2).

Google's package installation explicitly requires licence acceptance. The user declined native SDK work, so no acceptance or installation is pending in this task. Do not pipe automatic acceptance or reuse fabricated licence files. Android's current docs introduce the unified Android CLI while retaining command-line SDK/emulator instructions. Emulator/system-image downloads would be the substantial prerequisite in a separately authorized future task, even if the harness itself were tiny. [Licence step](https://developer.android.com/tools/sdkmanager#accept-licenses).

The harness should load the actual reviewed hosted page, implement only the necessary Wallet API test bridge, restrict navigation to the selected HTTPS origin, grant only explicitly requested video capture, and keep all bridge accounts/signatures as deterministic fixtures. It can relay APDUs to the existing Speculos test firmware. Test native WebView rendering, permissions, file picker, QR image/camera lifecycle, keyboard/rotation, local storage across restart, cancellation and bridge protocol boundaries. Route any submission to a test fixture rather than a live broadcast.

**A harness qualifies its WebView/bridge configuration, not stock Ledger Wallet Android.** It does not prove the official app's Discover manifest handling, permission policy, device chooser, BLE/USB transport or firmware installability. Chrome responsive emulation establishes even less. Official [WebView documentation](https://developer.android.com/develop/ui/views/layout/webapps/webview) explains that WebView behavior is configured by its native host.

## Building the official mobile host

The pinned 4.23 source declares SDK/build tools 36, NDK `28.0.12674087`, Kotlin 2.1.20 and Java 17 source/target compatibility; its wrapper pins Gradle `8.14.3`. JDK 21 compatibility must be verified by building; Java source/target 17 is not proof that an additional JDK 17 installation is mandatory. [Pinned build configuration](https://github.com/LedgerHQ/ledger-live/blob/abed962b08ca4b746f20192b28ce5b6c06a6c6a4/apps/ledger-live-mobile/android/build.gradle).

Ledger's own E2E instructions build mobile dependencies plus the CLI, use an API 36 AVD and Docker/Speculos, and specify `android.emu.release`; they document a broken local debug Detox/Espresso path. This is materially heavier than the harness and can involve upstream environment prerequisites. A successful local build would qualify the exact source/test build tested, which must still be distinguished from the store-signed app and physical-device transport. [Official mobile E2E guide](https://github.com/LedgerHQ/ledger-live/blob/abed962b08ca4b746f20192b28ce5b6c06a6c6a4/e2e/mobile/README.md).
