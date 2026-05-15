import { Link } from "react-router-dom";
import { Home, Search } from "lucide-react";
import { EditorialMasthead } from "@/components/EditorialMasthead";
import { EditorialFooter } from "@/components/EditorialFooter";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background">
      <EditorialMasthead />

      <main className="mx-auto max-w-6xl px-4 sm:px-6 py-20 sm:py-32 text-center">
        {/* Newspaper "EXTRA!" header */}
        <div className="mb-8">
          <span className="section-flag text-lg tracking-[0.2em] px-4 py-2">EXTRA! EXTRA!</span>
        </div>

        {/* Big 404 */}
        <p className="font-heading text-[120px] sm:text-[180px] font-black leading-none select-none text-foreground/5 mb-[-2rem] sm:mb-[-3rem]">
          404
        </p>

        <h1 className="font-heading text-3xl sm:text-4xl font-bold text-foreground mb-4">
          Page Not Found
        </h1>

        <div className="rule-accent mx-auto w-12 mb-6" />

        <p className="font-serif-body text-base text-muted-foreground max-w-sm mx-auto leading-relaxed mb-10">
          The page you're looking for doesn't exist or has been moved.
          But rest assured — your files are still safe. They never left your computer.
        </p>

        <div className="flex items-center justify-center gap-3">
          <Link to="/" className="btn-editorial inline-flex items-center gap-2">
            <Home size={14} /> GO HOME
          </Link>
          <Link
            to="/"
            className="inline-flex items-center gap-2 px-5 py-3 font-sans-ui text-xs font-bold uppercase tracking-widest text-muted-foreground border border-border hover:text-foreground hover:border-foreground/30 transition-all"
          >
            <Search size={14} /> SEARCH TOOLS
          </Link>
        </div>

        <p className="mt-16 font-mono-meta text-[10px] text-muted-foreground/85 uppercase tracking-widest">
          PrivaTools · 107 Privacy-First File Tools
        </p>
      </main>

      <EditorialFooter />
    </div>
  );
}
