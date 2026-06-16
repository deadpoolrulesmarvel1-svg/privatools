import { tools } from "./tools";
import { nonPdfTools } from "./non-pdf-tools";

export const PDF_TOOL_COUNT = tools.length;
export const NON_PDF_TOOL_COUNT = nonPdfTools.length;
export const TOTAL_TOOL_COUNT = PDF_TOOL_COUNT + NON_PDF_TOOL_COUNT;
export const TOOL_BREADTH_LABEL = `${TOTAL_TOOL_COUNT} tools (PDF, image, video, audio, dev)`;
