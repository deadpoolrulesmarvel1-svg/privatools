/**
 * The token worker for cl100k_base: counts and splits with that encoding, and
 * reads Word files, off the page's thread (see tokens-o200k.worker.ts for why
 * each encoding has a worker of its own). Its one rank table is built into
 * this script, so it makes no request of its own once loaded, and nothing in
 * it touches the network.
 */
import * as cl100k from "gpt-tokenizer/encoding/cl100k_base";
import type { GptEncoder } from "./gpt";
import { readDocxText } from "./docx";
import { serve } from "./jobs";

serve({
    encoders: [{ id: "cl100k_base", encoder: cl100k as GptEncoder }],
    readDocx: (bytes, name) => readDocxText(bytes, { name }),
});
