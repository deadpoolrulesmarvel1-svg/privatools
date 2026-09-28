/**
 * The ONLY module in this package that performs a network call.
 *
 * Kept that way deliberately: the promises this feature makes — the key goes
 * nowhere but the provider, never into a URL, never into an error message —
 * are only auditable if there is exactly one place to check.
 */

import { ByokError, classifyHttpStatus, type RequestContext } from "./errors";
import {
    buildRequest, buildTranscribeRequest, parseResponse, parseTranscribeResponse,
    providerById, supportsTranscription, TRANSCRIBE_MODELS, type Message,
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
        throw new ByokError("CspBlocked", `fetch failed: ${String(redact((err as Error).message))}`, blockedMessage(provider.label));
    }

    if (!res.ok) throw await refusal(res, { label: provider.label, model: args.model, customEndpoint: provider.customBaseUrl });

    const json = await res.json().catch(() => ({}));
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

/** Audio → text through the user's own key (OpenAI-style providers only). */
export async function transcribe(args: TranscribeArgs): Promise<string> {
    const provider = providerById(args.providerId);
    if (!provider) {
        throw new ByokError("Unsupported", `unknown provider ${args.providerId}`,
            "That provider is not supported. Pick one from the list.");
    }
    if (!supportsTranscription(provider)) {
        throw new ByokError("Unsupported", `no transcription on ${provider.id}`,
            `${provider.label} has no audio transcription API — use OpenAI, Groq, or a self-hosted endpoint.`);
    }
    registerSecret(args.apiKey);
    const model = args.model.trim() || TRANSCRIBE_MODELS[provider.id] || "whisper-1";
    const req = buildTranscribeRequest(provider, { ...args, model });

    let res: Response;
    try {
        res = await fetch(req.url, { method: "POST", headers: req.headers, body: req.body, signal: args.signal });
    } catch (err) {
        if ((err as Error)?.name === "AbortError") throw new ByokError("Aborted", "aborted", "Cancelled.");
        throw new ByokError("CspBlocked", `fetch failed: ${String(redact((err as Error).message))}`, blockedMessage(provider.label));
    }
    if (!res.ok) throw await refusal(res, { label: provider.label, model, customEndpoint: provider.customBaseUrl });
    return parseTranscribeResponse(await res.text()).trim();
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
 *  would send the visitor to look for a PrivaTools outage. */
function blockedMessage(label: string): string {
    return `The browser blocked the request to ${label}, or it got no answer. If you are using a custom endpoint it is probably not on the allowed list; otherwise check that this device is online and that no extension or filtering proxy is stopping the request. PrivaTools will not route your key or your file through its own server as a workaround.`;
}
