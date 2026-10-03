/**
 * The token worker for o200k_base: counts and splits with that encoding, off
 * the page's thread (jobs.ts holds the work; engine.ts starts this and talks
 * to it). Its one rank table is built into this script, so it makes no
 * request of its own once loaded, and nothing in it touches the network.
 *
 * One table per worker keeps each script under 2 MiB, the largest response
 * the backend compresses with Brotli (middleware/brotli.py); a script with
 * both tables went out with gzip made on the fly instead, about 1.4 seconds
 * of server time per download on the dev VM. Two workers also load, and
 * count, side by side. This one, the larger, leaves Word files to the other.
 */
import * as o200k from "gpt-tokenizer/encoding/o200k_base";
import type { GptEncoder } from "./gpt";
import { serve } from "./jobs";

serve({ encoders: [{ id: "o200k_base", encoder: o200k as GptEncoder }] });
