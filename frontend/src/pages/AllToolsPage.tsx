/**
 * AllToolsPage — the /tools directory hub.
 *
 * A flat, crawlable index of every PrivaTools tool, grouped by category. It is a
 * second internal-linking hub besides the homepage so internal PageRank reaches
 * the long-tail tool pages from more than one place. The backend server-renders
 * an equivalent <ul> of links for crawlers (see backend/app/seo_meta.py,
 * _build_ssr_content "/tools" branch); React replaces it with this richer
 * version on mount.
 */
import { Link } from "react-router-dom";
import { tools } from "@/data/tools";
import { nonPdfTools } from "@/data/non-pdf-tools";

const NONPDF_GROUPS: { key: string; label: string }[] = [
  { key: "image", label: "Image Tools" },
  { key: "video-audio", label: "Video & Audio Tools" },
  { key: "developer", label: "Developer Tools" },
  { key: "document-office", label: "Document & Office Tools" },
  { key: "archive", label: "Archive Tools" },
];

const TOTAL = tools.length + nonPdfTools.length;

function ToolLink({ href, name, description }: { href: string; name: string; description: string }) {
  return (
    <Link
      to={href}
      className="group flex flex-col rounded-lg border border-border/60 bg-card/40 p-4 transition-colors hover:border-primary/50 hover:bg-card"
    >
      <span className="font-medium text-foreground group-hover:text-primary">{name}</span>
      <span className="mt-1 line-clamp-2 text-sm text-muted-foreground">{description}</span>
    </Link>
  );
}

export default function AllToolsPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <nav className="mb-4 text-sm text-muted-foreground" aria-label="Breadcrumb">
        <Link to="/" className="hover:text-foreground">PrivaTools</Link>
        <span className="mx-1.5" aria-hidden="true">›</span>
        <span className="text-foreground">All Tools</span>
      </nav>

      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">All Free Online Tools</h1>
      <p className="mt-3 max-w-3xl text-muted-foreground">
        Every one of the {TOTAL} PrivaTools utilities, grouped by category. All free and open source
        under the MIT license — no account, no watermarks, no daily limits. Browser-only where possible;
        server-side tools run in an isolated container and delete your file immediately after the response.
      </p>

      <section className="mt-10">
        <h2 className="text-xl font-semibold">
          PDF Tools <span className="font-normal text-muted-foreground">({tools.length})</span>
        </h2>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tools.map((t) => (
            <ToolLink key={t.slug} href={`/tool/${t.slug}`} name={t.name} description={t.description} />
          ))}
        </div>
      </section>

      {NONPDF_GROUPS.map((group) => {
        const items = nonPdfTools.filter((t) => t.category === group.key);
        if (items.length === 0) return null;
        return (
          <section className="mt-10" key={group.key}>
            <h2 className="text-xl font-semibold">
              {group.label} <span className="font-normal text-muted-foreground">({items.length})</span>
            </h2>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((t) => (
                <ToolLink key={t.slug} href={`/tools/${t.slug}`} name={t.name} description={t.description} />
              ))}
            </div>
          </section>
        );
      })}

      <p className="mt-12 text-sm text-muted-foreground">
        Looking for guides? Visit the{" "}
        <Link to="/blog" className="underline underline-offset-2 hover:text-foreground">PrivaTools blog</Link>, or see how
        PrivaTools{" "}
        <Link to="/compare" className="underline underline-offset-2 hover:text-foreground">
          compares to iLovePDF, Smallpdf, and Adobe
        </Link>
        .
      </p>
    </main>
  );
}
