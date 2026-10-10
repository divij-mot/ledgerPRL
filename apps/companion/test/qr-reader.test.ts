import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QRCodeSVG } from "qrcode.react";
import { deriveAddress } from "@pearl-ledger/sdk";
import { publicAccount } from "../../../packages/wallet/test/fixtures.js";
import { parsePaymentQr, readQrImage, scanCamera } from "../src/qr-reader.js";
const address = deriveAddress(publicAccount, 0, 7).address;

test("QR requests validate network and exact amount without accepting foreign URLs or hidden instructions", () => {
  assert.deepEqual(parsePaymentQr(address, "regtest"), {
    address,
    amount: undefined,
  });
  assert.deepEqual(
    parsePaymentQr(`pearl:${address}?amount=0.001&label=Test`, "regtest"),
    { address, amount: "0.001" },
  );
  for (const text of [
    "",
    "x".repeat(2049),
    `https://example.com/${address}`,
    `bitcoin:${address}`,
    `pearl://${address}`,
    `pearl:${address}#fragment`,
    `pearl:${address}?amount=1&amount=2`,
    `pearl:${address}?req-unknown=1`,
    `pearl:${address}?amount=1e-4`,
    `pearl:${address}?amount=0`,
    `pearl:${address}?amount=0.000000001`,
    `pearl:${address}?amount=-1`,
  ])
    assert.throws(() => parsePaymentQr(text, "regtest"));
  assert.throws(() => parsePaymentQr(address, "mainnet"));
});

/** Rasterize the actual receive QR's horizontal SVG runs; no test-only decoder. */
function qrPixels(value: string) {
  const svg = renderToStaticMarkup(React.createElement(QRCodeSVG, { value }));
  const modules = Number(/viewBox="0 0 (\d+) /.exec(svg)![1]),
    scale = 5,
    margin = 4;
  const width = (modules + 2 * margin) * scale,
    data = new Uint8ClampedArray(width * width * 4).fill(255);
  const path = /fill="#000000" d="([^"]+)"/.exec(svg)![1]!;
  for (const match of path.matchAll(/M(\d+)[ ,](\d+)\s*h(\d+)v1H\d+z/g)) {
    const x = Number(match[1]),
      y = Number(match[2]),
      length = Number(match[3]);
    for (let row = (y + margin) * scale; row < (y + margin + 1) * scale; row++)
      for (
        let col = (x + margin) * scale;
        col < (x + margin + length) * scale;
        col++
      ) {
        const index = (row * width + col) * 4;
        data[index] = data[index + 1] = data[index + 2] = 0;
      }
  }
  return { width, height: width, data };
}
test("real jsQR decodes the actual receive QR pixels; mocked image decoding is closed afterward", async () => {
  const oldDocument = globalThis.document,
    oldBitmap = globalThis.createImageBitmap;
  const pixels = qrPixels(address);
  let closed = false;
  globalThis.document = {
    createElement: () => ({
      getContext: () => ({ drawImage() {}, getImageData: () => pixels }),
    }),
  } as any;
  globalThis.createImageBitmap = async () =>
    ({
      ...pixels,
      close: () => {
        closed = true;
      },
    }) as any;
  try {
    const text = await readQrImage(
      new File(["fixture"], "qr.png", { type: "image/png" }),
      new AbortController().signal,
    );
    assert.equal(text, address);
    assert(closed);
    assert.deepEqual(parsePaymentQr(text, "regtest"), {
      address,
      amount: undefined,
    });
    await assert.rejects(
      readQrImage(
        new File(["x"], "bad.svg", { type: "image/svg+xml" }),
        new AbortController().signal,
      ),
    );
  } finally {
    globalThis.document = oldDocument;
    globalThis.createImageBitmap = oldBitmap;
  }
});
test("cancelling camera permission before it resolves stops the late stream without applying a QR", async () => {
  const oldDocument = globalThis.document;
  const descriptor = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
  let resolveStream!: (stream: any) => void,
    stopped = 0;
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: () =>
        new Promise((resolve) => {
          resolveStream = resolve;
        }),
    },
  });
  globalThis.document = {
    createElement: () => ({ getContext: () => ({}) }),
  } as any;
  const video = {
    pause() {},
    srcObject: null,
    play: async () => {},
  } as unknown as HTMLVideoElement;
  const controller = new AbortController();
  try {
    const scan = scanCamera(video, controller.signal);
    while (!resolveStream)
      await new Promise((resolve) => setTimeout(resolve, 1));
    controller.abort();
    await assert.rejects(scan, /cancelled/);
    resolveStream({ getTracks: () => [{ stop: () => stopped++ }] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(stopped, 1);
    assert.equal(video.srcObject, null);
  } finally {
    globalThis.document = oldDocument;
    if (descriptor)
      Object.defineProperty(navigator, "mediaDevices", descriptor);
    else Reflect.deleteProperty(navigator, "mediaDevices");
  }
});
