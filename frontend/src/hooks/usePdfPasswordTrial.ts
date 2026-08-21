/**
 * React wrapper around trialVaultPasswords.
 *
 * The `trying` state is intentionally observable: the user always sees that
 * stored credentials were used, rather than passwords being applied invisibly.
 * That transparency is the deliberate UX choice for a privacy-first product —
 * a silent auto-unlock would be smoother and less honest.
 *
 * `makeOpener` is injected so tests never load the real pdf.js worker.
 */
import { useCallback, useState } from "react";
import { makePdfJsOpener, trialVaultPasswords, type OpenPdf } from "@/lib/pdfPassword";
import { blobBytes } from "@/lib/localStore/blobs";

export type TrialState =
  | { status: "idle" }
  | { status: "trying" }
  | { status: "notNeeded" }
  | { status: "unlocked"; password: string; entryId: string; tried: number }
  | { status: "needed"; tried: number }
  | { status: "error"; message: string };

export function usePdfPasswordTrial(makeOpener: () => Promise<OpenPdf> = makePdfJsOpener) {
  const [state, setState] = useState<TrialState>({ status: "idle" });

  const run = useCallback(
    async (file: File): Promise<TrialState> => {
      setState({ status: "trying" });
      try {
        // blobBytes, not file.arrayBuffer(): the latter is missing in Safari < 14.
        const data = new Uint8Array(await blobBytes(file));
        const open = await makeOpener();
        const result = (await trialVaultPasswords(data, open)) as TrialState;
        setState(result);
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Could not read that PDF.";
        const failed: TrialState = { status: "error", message };
        setState(failed);
        return failed;
      }
    },
    [makeOpener],
  );

  const reset = useCallback(() => setState({ status: "idle" }), []);

  return { state, run, reset };
}
