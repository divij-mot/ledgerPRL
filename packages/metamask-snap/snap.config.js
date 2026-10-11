// Used only by official mm-snap manifest/eval verification. The build is scripts/build.mjs.
export default {
  input: "src/index.tsx",
  output: { path: "dist", filename: "snap.js" },
  manifest: { path: "snap.manifest.json" },
  polyfills: false,
};
