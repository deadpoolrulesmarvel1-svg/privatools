/**
 * ToolFaq — the objection-answering FAQ every incumbent ships and we didn't.
 *
 * All five incumbents in the audit put an FAQ on every tool page, and it is
 * always the same job: answer the thing that stops someone uploading. Is it
 * really free, what happens to my file, is there a size limit, do I need an
 * account.
 *
 * The content already existed — 213 tools' worth, hand-written — but only as
 * JSON-LD for crawlers. Users never saw a word of it. This renders the same
 * source to people.
 *
 * Loaded lazily (47 KB gzipped for all 213) so it costs nothing on the home
 * page or anywhere outside a tool.
 */
import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useReveal } from "@/hooks/useReveal";

interface FaqEntry { q: string; a: string; }

export function ToolFaq({ slug, toolName }: { slug: string; toolName: string }) {
    const [entries, setEntries] = useState<FaqEntry[] | null>(null);
    const [open, setOpen] = useState<number | null>(0);
    const reveal = useReveal<HTMLElement>();

    useEffect(() => {
        let cancelled = false;
        import("@/data/tool-faq.json")
            .then(m => {
                if (cancelled) return;
                const all = m.default as Record<string, FaqEntry[]>;
                setEntries(all[slug] ?? null);
            })
            .catch(() => { /* the FAQ is a bonus; the tool still works without it */ });
        return () => { cancelled = true; };
    }, [slug]);

    if (!entries?.length) return null;

    return (
        <section ref={reveal} className="reveal mt-14" aria-labelledby="faq-heading">
            <h2 id="faq-heading" className="font-display text-[26px] sm:text-[30px] font-extrabold text-foreground tracking-[-0.03em] mb-1.5">
                Questions about {toolName}
            </h2>
            <p className="text-[14.5px] text-muted-foreground mb-6">
                The things people ask before uploading anything.
            </p>

            <ul className="divide-y divide-border rounded-[20px] border border-border bg-card overflow-hidden">
                {entries.map((e, i) => {
                    const isOpen = open === i;
                    return (
                        <li key={e.q}>
                            <h3>
                                <button
                                    type="button"
                                    onClick={() => setOpen(isOpen ? null : i)}
                                    aria-expanded={isOpen}
                                    aria-controls={`faq-panel-${i}`}
                                    className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-secondary/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:-ring-offset-2"
                                >
                                    <span className="flex-1 text-[15.5px] font-semibold text-foreground">{e.q}</span>
                                    <ChevronDown
                                        size={18}
                                        className={cn(
                                            "shrink-0 text-muted-foreground transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
                                            isOpen && "rotate-180 text-primary",
                                        )}
                                    />
                                </button>
                            </h3>
                            {/* Grid-rows trick animates to auto height without measuring. */}
                            <div
                                id={`faq-panel-${i}`}
                                className={cn(
                                    "grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
                                    isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
                                )}
                            >
                                <div className="overflow-hidden">
                                    <p className="px-5 pb-5 text-[14.5px] text-muted-foreground leading-relaxed max-w-[70ch]">
                                        {e.a}
                                    </p>
                                </div>
                            </div>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}
