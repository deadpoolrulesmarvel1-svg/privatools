import { createContext, useContext } from "react";
import { Laptop, Server, Sparkles, type LucideIcon } from "lucide-react";

/**
 * Where a tool's input goes: this browser, temporary server processing, the
 * visitor's own AI provider, or a choice between them. The registry's
 * `clientOnly` and `byok` flags decide it, in this order, unless the tool is
 * one whose processing they cannot describe: those have their own words in
 * OWN_LOCATION, taken from the tool's own engine cards, notes and guide.
 * Change the words only when the processing itself changes. The intake says
 * it in full (ToolWhere), the action bar by its label, and the "How it works"
 * panel repeats the detail.
 */
export type ToolLocationKind = "device" | "server" | "ai" | "choice";

export interface ToolLocation {
    kind: ToolLocationKind;
    /** A few words: the action bar and the intake's lead. */
    label: string;
    /** What happens to the input, in full. */
    detail: string;
}

/**
 * Tools that upload the file as soon as it is chosen, before the visitor runs
 * anything: Organize Pages draws its page thumbnails on the server, Remove
 * Watermark looks for watermarks there. src/test/upload-on-choice.test.tsx
 * chooses a file on every tool page and fails on a tool that sends anything
 * without being listed here and worded so in OWN_LOCATION.
 */
export const UPLOADS_WHEN_CHOSEN: readonly string[] = ["organize-pages", "remove-watermark"];

const SERVER: ToolLocation = {
    kind: "server",
    label: "Temporary server processing",
    detail: "Files are uploaded only when you run the tool. PrivaTools processes them in temporary storage and removes the job’s files after the response.",
};

const OWN_LOCATION: Record<string, ToolLocation> = {
    "remove-background": {
        kind: "choice",
        label: "Browser or server · your choice",
        detail: "Choose where to process before running. On this device downloads the model and processes images in your browser. The default server engine uploads images for temporary processing. Both options work without an account or an AI provider key.",
    },
    "ocr-pdf": {
        kind: "choice",
        label: "Server, your AI key or this browser · your choice",
        detail: "Choose an engine before running. On our server, Tesseract reads the PDF in temporary storage and the files are deleted after processing. With your own AI key, each page is rendered to an image and sent to the provider you choose. In this browser, tesseract.js reads the pages on your device and nothing uploads.",
    },
    "image-ocr": {
        kind: "choice",
        label: "Server, your AI key or this browser · your choice",
        detail: "Choose an engine before running. On our server, Tesseract reads the image in temporary storage and deletes it after processing. With your own AI key, the image goes to the provider you choose, not to PrivaTools. In this browser, tesseract.js reads it on your device and nothing uploads.",
    },
    "organize-pages": {
        kind: "server",
        label: "Temporary server processing",
        detail: "Your PDF is uploaded when you choose it, so PrivaTools can draw its page thumbnails, and again when you save. Both requests use temporary storage, and the job’s files are removed after each response.",
    },
    "remove-watermark": {
        kind: "server",
        label: "Temporary server processing",
        detail: "Your PDF is uploaded when you choose it, so PrivaTools can look for watermarks, and again when you remove the ones you confirm. Both requests use temporary storage, and the job’s files are removed after each response.",
    },
    // A step before the run that uploads: "Detect form fields" sends the PDF to read its fields.
    "fill-form": {
        kind: "server",
        label: "Temporary server processing",
        detail: "Your PDF is uploaded when you select “Detect form fields”, so PrivaTools can read its fields, and again when you fill it. Both requests use temporary storage, and the job’s files are removed after each response.",
    },
    // Tools whose input is not a file: the sentence names what is sent.
    "url-to-pdf": {
        kind: "server",
        label: "Temporary server processing",
        detail: "Only the address you enter leaves your device. When you run the tool, PrivaTools fetches that public page and renders it to a PDF in temporary storage, then removes the job’s files after the response.",
    },
    "html-to-pdf": {
        kind: "server",
        label: "Temporary server processing",
        detail: "When you run the tool, the address or the HTML you enter is sent to PrivaTools, which fetches the page or reads the HTML, renders the PDF in temporary storage and removes the job’s files after the response.",
    },
    "generate-barcode": {
        kind: "server",
        label: "Temporary server processing",
        detail: "When you run the tool, the text you enter is sent to PrivaTools, which draws the barcode in temporary storage and removes the job’s files after the response.",
    },
    "qr-code": {
        kind: "server",
        label: "Temporary server processing",
        detail: "When you run the tool, the text you enter, and a logo if you add one, is sent to PrivaTools, which draws the QR code in temporary storage and removes the job’s files after the response.",
    },
    "summarize-pdf": {
        kind: "ai",
        label: "This device or your AI key",
        detail: "Choose where the model runs before summarizing. On this device, a model downloads once and the PDF stays in your browser. With your own API key, the PDF’s text goes to the provider you choose, not to PrivaTools.",
    },
    "chat-with-pdf": {
        kind: "ai",
        label: "Your AI provider",
        detail: "The PDF is read on your device. Each question is sent, with the document text, straight from your browser to the provider you choose, using your key. It never passes through PrivaTools.",
    },
    "transcribe-audio": {
        kind: "ai",
        label: "This device or your AI key",
        detail: "Choose where the AI runs before transcribing. On this device, Whisper downloads once and the recording never leaves your browser. With your own API key, the audio goes directly to the provider you choose.",
    },
    "translate-pdf": {
        kind: "ai",
        label: "This device or your AI key",
        detail: "Choose a translator before running. On this device, a model downloads for each language pair and the PDF’s text stays in your browser. With your own API key, the text goes to the provider you choose, not to PrivaTools. “Save as PDF” sends the translated text, never the original file, to PrivaTools to be rendered, then deletes it.",
    },
    "smart-redact": {
        kind: "ai",
        label: "Your choice of AI, then temporary server processing",
        detail: "Choose how personal data is found before running. On this device, a model downloads once and nothing leaves the tab; with your own API key, the document’s text goes to the provider you choose. When you apply, the PDF and the strings you selected are sent to PrivaTools to be removed, then deleted on response.",
    },
};

export function toolLocation(tool: { slug: string; clientOnly?: boolean; byok?: boolean }): ToolLocation {
    const own = OWN_LOCATION[tool.slug];
    if (own) return own;
    if (tool.byok) return {
        kind: "ai",
        label: "Your choice of AI",
        detail: "Review your AI settings before running. Your provider receives requests you choose to send; some document steps also use PrivaTools.",
    };
    if (tool.clientOnly) return {
        kind: "device",
        label: "Stays on your device",
        detail: "Processing happens in this browser. Your input stays on this device.",
    };
    return SERVER;
}

/** Whether a tool has wording of its own rather than its flags' default. */
export function hasOwnLocation(slug: string): boolean {
    return Object.prototype.hasOwnProperty.call(OWN_LOCATION, slug);
}

export const LOCATION_ICONS: Record<ToolLocationKind, LucideIcon> = { device: Laptop, server: Server, ai: Sparkles, choice: Sparkles };

const ToolLocationContext = createContext<ToolLocation | null>(null);
export const ToolLocationProvider = ToolLocationContext.Provider;

/** The tool page's location, or null outside a tool page (tests, Batch, Pipeline). */
export function useToolLocation(): ToolLocation | null {
    return useContext(ToolLocationContext);
}
