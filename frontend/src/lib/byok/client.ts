/**
 * The ONLY module in this package that performs a network call.
 *
 * Kept that way deliberately: the promises this feature makes — the key goes
 * nowhere but the provider, never into a URL, never into an error message —
 * are only auditable if there is exactly one place to check. Three calls:
 * `complete`, `transcribe` and `countTokens`.
 */

import { ByokError, classifyHttpStatus, type RequestContext } from "./errors";
import {
    buildCountTokensRequest, buildRequest, buildTranscribeRequest, parseCountTokensResponse, parseResponse, parseTranscribeResponse,
    providerById, stoppedShort, supportsTokenCount, supportsTranscription, transcriptionProviderNames, type Message, type Provider,
} from "./providers";
import { redact, registerSecret } from "./redact";

export interface CompleteArgs {
    providerId: string;
    apiKey: string;
    model: string;
    messages: Message[];
    baseUrl?: string;
    maxTokens?: number;
    signal?: AbortSignal;
}

export async function complete(args: CompleteArgs): Promise<string> {
    const provider = providerById(args.providerId);
    if (!provider) {
        throw new ByokError(
            "Unsupported",
            `unknown provider ${args.providerId}`,
            "That provider is not supported. Pick one from the list.",
        );
    }

    registerSecret(args.apiKey);
    const req = buildRequest(provider, args);

    let res: Response;
    try {
        res = await fetch(req.url, {
            method: "POST",
            headers: req.headers,
            body: req.body,
            signal: args.signal,
        });
    } catch (err) {
        if ((err as Error)?.name === "AbortError") {
            throw new ByokError("Aborted", "aborted", "Cancelled.");
        }
        // A CSP refusal and an offline network both surface as TypeError here;
        // the browser deliberately does not distinguish them. Naming CSP first
        // is the more useful guess: "check your connection" sends someone to
        // debug the wrong thing, and this path is only reachable for a
        // provider that was already configured.
        throw new ByokError("CspBlocked", `fetch failed: ${String(redact((err as Error).message))}`, blockedMessage(provider));
    }

    if (!res.ok) throw await refusal(res, { label: provider.label, model: args.model, customEndpoint: provider.customBaseUrl });

    const json = await res.json().catch(() => ({}));
    // Before the text: what came with a refusal or a cut-off is not an answer.
    const short = stoppedShort(provider, json);
    if (short === "declined") {
        throw new ByokError(
            "Declined",
            "model declined (stop_reason refusal)",
            "Claude declined to answer this request, so there is no answer to show. That was the model's decision, not a fault in your key; rewording the request may help.",
        );
    }
    if (short === "cut-off") {
        throw new ByokError(
            "TooLong",
            "answer stopped at its length limit",
            "Claude stopped before finishing its answer: it reached the length limit for one request, and the model's thinking counts toward that limit. The unfinished answer is left out. Ask for less at once, such as a shorter document or a narrower question.",
        );
    }
    const text = parseResponse(provider, json);
    if (!text.trim()) throw new ByokError("Unknown", "provider returned no text", "The provider returned no answer. Check the model name or try a different model.");
    return text;
}

export interface TranscribeArgs {
    providerId: string;
    apiKey: string;
    /** Empty string → the provider's default transcription model. */
    model: string;
    file: File | Blob;
    filename?: string;
    baseUrl?: string;
    signal?: AbortSignal;
}

/** Audio → text through the user's own key, for providers with a speech-to-text endpoint. */
export async function transcribe(args: TranscribeArgs): Promise<string> {
    const provider = providerById(args.providerId);
    if (!provider) {
        throw new ByokError("Unsupported", `unknown provider ${args.providerId}`,
            "That provider is not supported. Pick one from the list.");
    }
    if (!supportsTranscription(provider) || !provider.transcribeModel) {
        throw new ByokError("Unsupported", `no transcription on ${provider.id}`,
            `${provider.label} has no audio transcription API — use ${transcriptionProviderNames()}.`);
    }
    registerSecret(args.apiKey);
    const model = args.model.trim() || provider.transcribeModel;
    const req = buildTranscribeRequest(provider, { ...args, model });

    let res: Response;
    try {
        res = await fetch(req.url, { method: "POST", headers: req.headers, body: req.body, signal: args.signal });
    } catch (err) {
        if ((err as Error)?.name === "AbortError") throw new ByokError("Aborted", "aborted", "Cancelled.");
        throw new ByokError("CspBlocked", `fetch failed: ${String(redact((err as Error).message))}`, blockedMessage(provider));
    }
    if (!res.ok) throw await refusal(res, { label: provider.label, model, customEndpoint: provider.customBaseUrl });
    return parseTranscribeResponse(await res.text()).trim();
}

export interface CountTokensArgs {
    providerId: string;
    apiKey: string;
    model: string;
    /** Sent as it is, as one user message. */
    text: string;
    signal?: AbortSignal;
}

/**
 * How many tokens the provider's own tokenizer makes of the text, from its
 * count method (Anthropic's count_tokens, Gemini's countTokens): nothing is
 * generated. Only providers with such a method; the text goes nowhere else.
 */
export async function countTokens(args: CountTokensArgs): Promise<number> {
    const provider = providerById(args.providerId);
    if (!provider) {
        throw new ByokError("Unsupported", `unknown provider ${args.providerId}`,
            "That provider is not supported. Pick one from the list.");
    }
    if (!supportsTokenCount(provider)) {
        throw new ByokError("Unsupported", `no token count on ${provider.id}`,
            `${provider.label} has no token-count method this page can use.`);
    }
    registerSecret(args.apiKey);
    const req = buildCountTokensRequest(provider, args);

    let res: Response;
    try {
        res = await fetch(req.url, { method: "POST", headers: req.headers, body: req.body, signal: args.signal });
    } catch (err) {
        if ((err as Error)?.name === "AbortError") throw new ByokError("Aborted", "aborted", "Cancelled.");
        throw new ByokError("CspBlocked", `fetch failed: ${String(redact((err as Error).message))}`, blockedMessage(provider));
    }
    if (!res.ok) throw await refusal(res, { label: provider.label, model: args.model });
    const count = parseCountTokensResponse(provider, await res.json().catch(() => undefined));
    if (count === undefined) {
        throw new ByokError("Unknown", "no token count in the answer",
            `${provider.label} answered without a token count. Try again, or check the model name.`);
    }
    return count;
}

/**
 * The error for a request the provider refused. Its body is read only to tell
 * a bad key, an unknown model and an oversized request apart; the thrown
 * error never carries it (see classifyHttpStatus).
 */
async function refusal(res: Response, context: RequestContext): Promise<ByokError> {
    let body = "";
    try { body = await res.text(); } catch { /* the status alone still classifies it */ }
    return classifyHttpStatus(res.status, body, context);
}

/** Worded without "network" or "connection": the pages' generic rewording
 *  (friendlyError) turns those into "Couldn't reach the server", which
 *  would send the visitor to look for a PrivaTools outage.
 *
 *  A provider that refuses a key without CORS headers (OpenAI) produces the
 *  same failed request as a blocked one, so for it the key comes first. */
function blockedMessage(provider: Provider): string {
    const noProxy = " PrivaTools will not route your key or your file through its own server as a workaround.";
    const { label } = provider;
    if (provider.refusalsUnreadable) {
        return `The browser could not read ${label}'s answer. ${label} answers that way when it refuses the key, so check the key on ${label}'s site first. If it is correct and active, check that this device is online and that no extension or filtering proxy is stopping the request.${noProxy}`;
    }
    // Only the custom endpoint can be an address this page's policy doesn't allow.
    const check = provider.customBaseUrl ? "If you are using a custom endpoint it is probably not on the allowed list; otherwise check" : "Check";
    return `The browser blocked the request to ${label}, or it got no answer. ${check} that this device is online and that no extension or filtering proxy is stopping the request.${noProxy}`;
}
