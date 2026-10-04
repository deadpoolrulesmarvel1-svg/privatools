/**
 * Keeping the page drawing while a transformers.js model runs on its thread.
 *
 * A model's run is a series of steps (one per word a translation or
 * transcription writes) that each await only a microtask, so nothing else
 * on the page gets a turn until the run ends: no progress drawn, no click
 * taken. Waiting for the next task before each step gives the page a turn
 * between steps, at the cost of well under a millisecond each, though not
 * during one step. Whisper (lib/whisper.ts) and OPUS-MT (lib/translate/opusMt.ts)
 * both use it on the page's thread.
 */

/** The next task, not a microtask, queued behind the page's own work so it can draw and take input first. */
export function nextTask(): Promise<void> {
    return new Promise(resolve => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => { channel.port1.close(); resolve(); };
        channel.port2.postMessage(null);
    });
}

type Session = { run: (...args: unknown[]) => Promise<unknown> };

/** Make every step of a loaded pipeline's model wait for the next task first. */
export function yieldBetweenSteps(pipeline: unknown): void {
    const sessions = (pipeline as { model?: { sessions?: Record<string, Session> } } | null)?.model?.sessions ?? {};
    for (const session of Object.values(sessions)) {
        const run = session.run.bind(session);
        session.run = async (...args: unknown[]) => { await nextTask(); return run(...args); };
    }
}
