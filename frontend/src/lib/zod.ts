/**
 * zod for this app: import `z` from here, never from "zod" (ESLint holds that).
 *
 * Zod 4 compiles object parsers with `new Function` when it may, and finds out
 * by trying `new Function("")` as the first object schema is built. The
 * production CSP has no 'unsafe-eval', so the browser refuses that try and
 * reports a script-src violation, on every page: the account panel's schemas
 * load with the app. jitless, set here before any schema exists, skips both
 * the try and the compiled parsers. Validation is unchanged; parsing large
 * objects is slower, and these are small.
 */
import { z } from "zod";

z.config({ jitless: true });

export { z };
