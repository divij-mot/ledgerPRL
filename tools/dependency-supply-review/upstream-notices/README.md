# Supplemental dependency notices

These files preserve notices missing from the pinned npm tarballs. `provenance.json` records the exact package version, official release commit, retrieval URL, file path and SHA-256. They are consumed only when the measured browser/CSS graph includes the corresponding package/version.

- Lumen UI and design-core release tags resolve to `cf3c5fbad324cb3aa5af9882695d54992ca5a86e`; utils-shared resolves to `eefb54d842a3e5adcd4fcefc7453d7f34e512412`. Their unchanged repository Apache-2.0 licenses are retained. The current graph does not emit utils-shared, so its retained source is not automatically included in distributed notices.
- `@ledgerhq/hw-transport@6.36.0` and `@ledgerhq/logs@6.19.0` declare Apache-2.0 but omit license files in both tarballs and exact source tags. Their original package declarations and the standard Apache Software Foundation license text are retained. No package-specific copyright holder or NOTICE is invented.
- `@ledgerhq/wallet-api-core@2.1.0` declares MIT but supplies no license/copyright body in the tarball or exact source tag. Its original declaration is retained, and the distributed notices explicitly identify this unresolved attribution gap. The separately licensed Wallet API client is Apache-2.0; its license is not silently assigned to core. Obtain the missing applicable copyright/terms from upstream before public distribution.

This is source attribution evidence, not a legal opinion or a completed licensing review. Exact license bodies are preserved unchanged. Package metadata, tags and licenses do not establish authenticity of every installed source file or security of its behavior.
