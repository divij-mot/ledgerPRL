/** QR decoding follows Ledger Wallet 4.23.0's jsQR camera loop; see vendor provenance. */
import {
  addressToScript,
  assert,
  parsePrl,
  type NetworkName,
} from "@pearl-ledger/sdk";

export function parsePaymentQr(text: string, network: NetworkName) {
  assert(
    typeof text === "string" && text.length > 0 && text.length <= 2048,
    "Invalid payment QR code",
  );
  let address = text.trim(),
    amount: string | undefined;
  if (/^pearl:/i.test(address)) {
    const uri = new URL(address);
    assert(
      uri.protocol.toLowerCase() === "pearl:" && !uri.host && !uri.hash,
      "Invalid Pearl payment request",
    );
    address = uri.pathname;
    const seen = new Set<string>();
    for (const [key, value] of uri.searchParams) {
      assert(
        !seen.has(key) && ["amount", "label", "message"].includes(key),
        "Unsupported payment request field",
      );
      seen.add(key);
      if (key === "amount") {
        assert(parsePrl(value) > 0n, "Payment request amount must be positive");
        amount = value;
      }
    }
  }
  addressToScript(address, network);
  return { address, amount };
}

async function decoder() {
  const { default: decode } = await import("jsqr");
  return decode;
}
export async function readQrImage(
  file: File,
  signal: AbortSignal,
): Promise<string> {
  assert(
    file.size > 0 &&
      file.size <= 8 * 1024 * 1024 &&
      ["image/png", "image/jpeg", "image/webp"].includes(file.type),
    "Choose a PNG, JPEG or WebP QR image under 8 MB",
  );
  signal.throwIfAborted();
  const bitmap = await createImageBitmap(file, {
    resizeWidth: 1024,
    resizeHeight: 1024,
    resizeQuality: "high",
  });
  try {
    signal.throwIfAborted();
    assert(
      bitmap.width > 0 &&
        bitmap.height > 0 &&
        bitmap.width * bitmap.height <= 4_000_000,
      "QR image is too large",
    );
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    assert(context, "Image scanning is unavailable here");
    context.drawImage(bitmap, 0, 0);
    const decode = await decoder();
    signal.throwIfAborted();
    const code = decode(
      context.getImageData(0, 0, canvas.width, canvas.height).data,
      canvas.width,
      canvas.height,
    );
    assert(code?.data, "No readable QR code found in this image");
    return code.data;
  } finally {
    bitmap.close();
  }
}

export async function scanCamera(
  video: HTMLVideoElement,
  signal: AbortSignal,
): Promise<string> {
  assert(
    navigator.mediaDevices?.getUserMedia,
    "Camera unavailable. Choose a QR image or paste the address.",
  );
  const decode = await decoder();
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    let stream: MediaStream | undefined,
      timer: ReturnType<typeof setInterval> | undefined,
      settled = false;
    const canvas = document.createElement("canvas"),
      context = canvas.getContext("2d", { willReadFrequently: true });
    const finish = (error?: Error, value?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearInterval(timer);
      signal.removeEventListener("abort", abort);
      stream?.getTracks().forEach((track) => track.stop());
      video.pause();
      video.srcObject = null;
      if (error) reject(error);
      else resolve(value!);
    };
    const abort = () => finish(new Error("QR scan cancelled"));
    const timeout = setTimeout(
      () =>
        finish(new Error("Camera timed out. Choose a QR image or try again.")),
      30_000,
    );
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    if (!context) {
      finish(new Error("Camera scanning is unavailable here"));
      return;
    }
    void navigator.mediaDevices
      .getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
      })
      .then(async (acquired) => {
        if (settled) {
          acquired.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = acquired;
        video.srcObject = stream;
        await video.play();
        if (settled) return;
        timer = setInterval(() => {
          if (video.readyState < 2 || !video.videoWidth || !video.videoHeight)
            return;
          try {
            const scale = Math.min(
              1,
              640 / Math.max(video.videoWidth, video.videoHeight),
            );
            canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
            canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            const code = decode(
              context.getImageData(0, 0, canvas.width, canvas.height).data,
              canvas.width,
              canvas.height,
            );
            if (code?.data) finish(undefined, code.data);
          } catch {
            finish(
              new Error(
                "Could not read the camera. Choose a QR image instead.",
              ),
            );
          }
        }, 400);
      })
      .catch(() =>
        finish(
          new Error(
            "Camera access unavailable. Choose a QR image or paste the address.",
          ),
        ),
      );
  });
}
