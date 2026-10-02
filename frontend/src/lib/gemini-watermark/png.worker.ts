/** Runs the PNG path (png-job.ts) off the page's main thread, one file per worker. */
import { failureReply, processPngBytes, type PngJobReply } from "./png-job";

self.onmessage = (event: MessageEvent<Uint8Array>) => {
    let reply: PngJobReply;
    try {
        reply = { ok: true, result: processPngBytes(event.data) };
    } catch (error) {
        reply = failureReply(error);
    }
    const bytes = reply.ok && reply.result.status === "removed" ? reply.result.bytes : null;
    self.postMessage(reply, bytes ? { transfer: [bytes.buffer] } : undefined);
};

export {};
