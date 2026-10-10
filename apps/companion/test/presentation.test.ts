import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { countLabel, navigationIcon } from "../src/presentation.js";

test("navigation icons use decorative inline SVG rather than font glyphs", () => {
  const icons = ["overview", "receive", "send", "activity"] as const;
  assert.equal(new Set(icons.map(navigationIcon)).size, icons.length);
  for (const page of icons) {
    const icon = navigationIcon(page);
    assert.match(icon, /^<svg width="17" height="17" viewBox="0 0 24 24"/);
    assert.match(icon, /stroke="currentColor"/);
    assert.match(icon, /aria-hidden="true" focusable="false"/);
    assert.doesNotMatch(icon, /<script|<text|style=|href=|◫|↙|↗|≋/);
  }
});

test("visible payment counts use singular only for one", () => {
  for (const noun of ["record", "input", "output", "reserved output"]) {
    assert.equal(countLabel(0, noun), `0 ${noun}s`);
    assert.equal(countLabel(1, noun), `1 ${noun}`);
    assert.equal(countLabel(2, noun), `2 ${noun}s`);
  }
});

test("recipient label names both supported output address types", async () => {
  const source = await readFile(
    new URL("../src/main.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /<label for="recipient">Recipient address \(P2TR or P2MR\)<\/label>/,
  );
  assert.doesNotMatch(source, /Recipient P2TR address/);
});
