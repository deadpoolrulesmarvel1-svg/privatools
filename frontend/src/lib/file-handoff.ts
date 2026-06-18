export const FILE_HANDOFF_KEY = "privatools.file-handoff";

const MAX_HANDOFF_AGE_MS = 10 * 60 * 1000;

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
