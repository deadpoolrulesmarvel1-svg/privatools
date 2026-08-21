/**
 * Blob reading with universal fallbacks.
 *
 * `Blob.arrayBuffer()` and `Blob.text()` are missing in Safari < 14 (and in the
 * jsdom build the test suite runs on). FileReader is available everywhere, so
 * these helpers use the modern method when present and fall back otherwise.
 */

export function blobBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error("Could not read that file."));
    reader.readAsArrayBuffer(blob);
  });
}

export function blobText(blob: Blob): Promise<string> {
  if (typeof blob.text === "function") return blob.text();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read that file."));
    reader.readAsText(blob);
  });
}
