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
    const blob = await fetch(payload.data).then(r => r.blob());
    return new File([blob], payload.name, {
      type: payload.type || blob.type,
      lastModified: Date.now(),
    });
  } catch {
    return null;
  }
}
