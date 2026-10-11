import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { countLabel } from "../src/presentation.js";

test("visible payment counts use singular only for one", () => {
  for (const noun of ["record", "input", "output", "reserved output"]) {
    assert.equal(countLabel(0, noun), `0 ${noun}s`);
    assert.equal(countLabel(1, noun), `1 ${noun}`);
    assert.equal(countLabel(2, noun), `2 ${noun}s`);
  }
});

test("source-derived recipient field uses the native address label", async () => {
  const source = await readFile(
    new URL("../src/ledger-ui/StepRecipient.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /<label htmlFor="recipient">\s*Recipient address\s*<\/label>/,
  );
  assert.doesNotMatch(source, /Recipient P2TR address/);
});
