/**
 * Client-side PDF password trial.
 *
 * This is the security property the whole vault design rests on: candidate
 * passwords are tested locally with pdf.js, so only a password that actually
 * works is ever sent to the server — exactly what would have crossed the wire
 * if the user had typed it. Wrong candidates never leave the browser.
 *
 * If anyone ever refactors this to ask the server "does this password work?",
 * the "never performs a network request" test must fail loudly.
 *
 * Limitation: pdf.js can only trial the USER password (the one that blocks
 * opening). An OWNER password merely restricts permissions, and pdf.js opens
 * such a file with an empty user password, so it cannot verify one. Tools that
 * take an owner password offer autofill from the vault instead of a trial.
 */
import * as vault from "./localStore/vault";

/** Opens a PDF, resolving on success and throwing PasswordException otherwise. */
export type OpenPdf = (data: Uint8Array, password?: string) => Promise<unknown>;

export type TrialResult =
  | { status: "notNeeded" }
  | { status: "unlocked"; password: string; entryId: string; tried: number }
  | { status: "needed"; tried: number };

function isPasswordError(err: unknown): boolean {
  return (err as { name?: string } | null)?.name === "PasswordException";
}

export async function trialVaultPasswords(
  data: Uint8Array,
  open: OpenPdf,
): Promise<TrialResult> {
  try {
    await open(data);
    return { status: "notNeeded" };
  } catch (err) {
    if (!isPasswordError(err)) throw err;
  }

  const candidates = await vault.candidatesByRecency();
  let tried = 0;

  for (const candidate of candidates) {
    tried++;
    try {
      await open(data, candidate.password);
      await vault.markUsed(candidate.id);
      return { status: "unlocked", password: candidate.password, entryId: candidate.id, tried };
    } catch (err) {
      if (!isPasswordError(err)) throw err;
    }
  }

  return { status: "needed", tried };
}

/** Real pdf.js opener. Lazily imported so the worker only loads when needed. */
export async function makePdfJsOpener(): Promise<OpenPdf> {
  const pdfjsLib = await import("pdfjs-dist");
  const workerSrc = (await import("pdfjs-dist/build/pdf.worker.mjs?url")).default;
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

  return async (data: Uint8Array, password?: string) => {
    // pdf.js transfers the underlying buffer, so hand it a fresh copy per
    // attempt — otherwise the second candidate sees a detached ArrayBuffer.
    const task = pdfjsLib.getDocument({ data: data.slice(), password });
    const doc = await task.promise;
    void doc.destroy();
    return doc;
  };
}
