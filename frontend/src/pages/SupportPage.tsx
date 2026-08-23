/**
 * Support — Signature.
 *
 * Deliberately not a ticket form: there is no ticketing system behind one, and a
 * form that silently goes nowhere is worse than an address. One person reads
 * what arrives, and the page says so rather than implying a support desk.
 */
import { Link } from "react-router-dom";
import { Bug, Github, LifeBuoy, Mail, ShieldAlert } from "lucide-react";
import { TOTAL_TOOL_COUNT } from "@/data/site-stats";

const CHANNELS = [
    {
        icon: Bug, title: "Something is broken",
        body: "Open an issue with the tool name and what you expected. If a file failed, say what kind — never attach the file itself.",
        cta: "Open an issue", href: "https://github.com/deadpoolrulesmarvel1-svg/privatools/issues",
        external: true,
    },
    {
        icon: ShieldAlert, title: "Security report",
        body: "Email directly rather than filing publicly, and give us a chance to fix it before disclosure.",
        cta: "hello@privatools.me", href: "mailto:hello@privatools.me", external: true,
    },
    {
        icon: Mail, title: "Anything else",
        body: "Questions, a tool you wish existed, or something that read as misleading — all welcome.",
        cta: "hello@privatools.me", href: "mailto:hello@privatools.me", external: true,
    },
    {
        icon: Github, title: "Read the code",
        body: `All ${TOTAL_TOOL_COUNT} tools are MIT-licensed and self-hostable. If you would rather run it yourself, you can.`,
        cta: "View on GitHub", href: "https://github.com/deadpoolrulesmarvel1-svg/privatools",
        external: true,
    },
] as const;

export default function SupportPage() {
    return (
        <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
            <h1 className="font-display text-[30px] font-bold tracking-[-0.025em]">Support</h1>
            <p className="mt-1.5 text-[14px] text-muted-foreground">
                One person builds and maintains this, so replies are human but not instant.
            </p>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
                {CHANNELS.map(c => (
                    <a key={c.title} href={c.href}
                       {...(c.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                       className="rounded-2xl border border-border bg-card p-5 transition-colors hover:border-primary/50">
                        <c.icon size={17} className="text-primary" aria-hidden="true" />
                        <h2 className="mt-2.5 font-display text-[15px] font-semibold">{c.title}</h2>
                        <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{c.body}</p>
                        <span className="mt-3 inline-block text-[12.5px] font-medium text-primary">{c.cta} →</span>
                    </a>
                ))}
            </div>

            <div className="mt-5 rounded-2xl border border-border bg-secondary/40 p-5">
                <h2 className="font-display text-[15px] font-semibold flex items-center gap-2">
                    <LifeBuoy size={16} className="text-primary" aria-hidden="true" />
                    Before you write
                </h2>
                <ul className="mt-2.5 grid gap-1.5 text-[13px] leading-relaxed text-muted-foreground">
                    <li>Check <Link to="/status" className="text-primary hover:underline">service status</Link> — a failing tool is often a server that is briefly unreachable.</li>
                    <li>Browser-only tools keep working with no network; server tools do not.</li>
                    <li>Never send us a document. We cannot accept files, and we do not want them.</li>
                </ul>
            </div>
        </div>
    );
}
