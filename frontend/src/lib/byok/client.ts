/**
 * The ONLY module in this package that performs a network call.
 *
 * Kept that way deliberately: the promises this feature makes — the key goes
 * nowhere but the provider, never into a URL, never into an error message —
 * are only auditable if there is exactly one place to check.
 */

import { ByokError, classifyHttpStatus } from "./errors";
import { buildRequest, parseResponse, providerById, type Message } from "./providers";
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
        throw new ByokError(
            "CspBlocked",
            `fetch failed: ${String(redact((err as Error).message))}`,
            `The browser blocked the request to ${provider.label}. If you are using a custom endpoint it is probably not on the allowed list; otherwise check whether something on your network is intercepting it. PrivaTools will not route your key or your file through its own server as a workaround.`,
        );
    }

    if (!res.ok) throw classifyHttpStatus(res.status);

    const json = await res.json().catch(() => ({}));
    return parseResponse(provider, json);
}
