/**
 * Client-side PDF metadata reads.
 *
 * Bates numbering has to advance its counter by the number of pages actually
 * stamped. Asking the server for that would be a second round-trip carrying the
 * user's document again, for a number pdf.js can read locally in milliseconds.
 *
 * `open` is injectable so tests never load the pdf.js worker.
 */

export type OpenForCount = (data: Uint8Array) => Promise<{ numPages: number; destroy?: () => unknown }>;

let defaultOpener: OpenForCount | null = null;

async function pdfJsOpener(): Promise<OpenForCount> {
  if (defaultOpener) return defaultOpener;
  const pdfjsLib = await import("pdfjs-dist");
  const workerSrc = (await import("pdfjs-dist/build/pdf.worker.mjs?url")).default;
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
  defaultOpener = async (data: Uint8Array) => {
    const doc = await pdfjsLib.getDocument({ data: data.slice() }).promise;
    return doc;
  };
  return defaultOpener;
}

/**
 * Total pages across several PDFs. Files that can't be read (encrypted,
 * corrupt) contribute 0 rather than throwing — a page count is an optimization
 * for the counter, never a reason to fail the user's actual job.
 */
export async function countPdfPages(
  files: File[],
  readBytes: (f: File) => Promise<ArrayBuffer>,
  open?: OpenForCount,
): Promise<number> {
  const opener = open ?? (await pdfJsOpener());
  let total = 0;
  for (const file of files) {
    try {
      const doc = await opener(new Uint8Array(await readBytes(file)));
      total += doc.numPages ?? 0;
      doc.destroy?.();
    } catch {
      /* unreadable — contributes nothing */
    }
  }
  return total;
}
