export const FILE_HANDOFF_KEY = "privatools.file-handoff";

const MAX_HANDOFF_AGE_MS = 10 * 60 * 1000;

// Cap the handoff payload. sessionStorage quota is ~5 MB and a base64 data URL
// inflates the file by ~33%, so a larger file would throw on setItem (silently
// failing the handoff) or leave a multi-MB blob sitting in the tab's storage.
// Above this, we skip the convenience handoff and just re-prompt for upload.
const MAX_HANDOFF_BYTES = 3 * 1024 * 1024;

type StoredFileHandoff = {
  name: string;
  type: string;
  data: string;
  targetSlug?: string;
  createdAt: number;
};

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("FileReader did not return a data URL"));
    };
    reader.readAsDataURL(file);
  });
}

export async function storeFileHandoff(file: File, targetSlug?: string): Promise<boolean> {
  // Skip the handoff for files too large to fit sessionStorage safely.
  if (file.size > MAX_HANDOFF_BYTES) return false;
  try {
    const payload: StoredFileHandoff = {
      name: file.name || "clipboard-file",
      type: file.type || "application/octet-stream",
      data: await readAsDataUrl(file),
      targetSlug,
      createdAt: Date.now(),
    };
    sessionStorage.setItem(FILE_HANDOFF_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export async function consumeFileHandoff(targetSlug?: string): Promise<File | null> {
  let payload: StoredFileHandoff | null = null;
  try {
    const raw = sessionStorage.getItem(FILE_HANDOFF_KEY);
    if (!raw) return null;
    payload = JSON.parse(raw) as StoredFileHandoff;
  } catch {
    try { sessionStorage.removeItem(FILE_HANDOFF_KEY); } catch {}
    return null;
  }

  if (!payload?.data || !payload.name) {
    try { sessionStorage.removeItem(FILE_HANDOFF_KEY); } catch {}
    return null;
  }

  const expired = Date.now() - (payload.createdAt || 0) > MAX_HANDOFF_AGE_MS;
  if (expired) {
    try { sessionStorage.removeItem(FILE_HANDOFF_KEY); } catch {}
    return null;
  }

  if (targetSlug && payload.targetSlug && payload.targetSlug !== targetSlug) {
    return null;
  }

  try {
    sessionStorage.removeItem(FILE_HANDOFF_KEY);
    // Decode the data URL directly rather than `fetch(dataUrl)` → blob: fetch
    // of a data: URL is unsupported/inconsistent in some runtimes (notably
    // node/jsdom under tests), where it yields a Blob that stringifies to
    // "[object Blob]" instead of the bytes. A manual base64 decode is exact
    // and works everywhere.
    return dataUrlToFile(payload.data, payload.name, payload.type);
  } catch {
    return null;
  }
}

function dataUrlToFile(dataUrl: string, name: string, type?: string): File {
  const comma = dataUrl.indexOf(",");
  if (comma === -1) throw new Error("Malformed data URL");
  const header = dataUrl.slice(0, comma);
  const body = dataUrl.slice(comma + 1);
  const mime = type || header.match(/^data:([^;,]*)/)?.[1] || "application/octet-stream";

  let bytes: Uint8Array;
  if (/;base64/i.test(header)) {
    const bin = atob(body);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } else {
    bytes = new TextEncoder().encode(decodeURIComponent(body));
  }
  return new File([bytes], name, { type: mime, lastModified: Date.now() });
}
