import { useParams, Link } from "react-router-dom";
import { Shield, Check, X, Zap, Globe, Lock, Heart, Github, ArrowRight, Cloud, ServerCog, DollarSign, Eye, EyeOff } from "lucide-react";
import { EditorialMasthead } from "@/components/EditorialMasthead";
import { EditorialFooter } from "@/components/EditorialFooter";
import { cn } from "@/lib/utils";

interface CompetitorData {
  name: string;
  slug: string;
  tagline: string;
  // SEO / card metadata
  toolCount?: string;
  pricing?: string;
  freeLimit?: string;
  openSource?: boolean;
  selfHostable?: boolean;
  cloudUploads?: boolean;
  features: Record<string, boolean | string>;
}

const competitors: Record<string, CompetitorData> = {
  ilovepdf: {
    name: "iLovePDF",
    slug: "ilovepdf",
    tagline: "Popular PDF tool suite with ads and file limits",
    toolCount: "~25 (PDF only)",
    pricing: "$4/mo Premium",
    freeLimit: "25 MB free",
    openSource: false,
    selfHostable: false,
    cloudUploads: true,
    features: {
      "Free to use": "Limited",
      "No account required": "No",
      "No file size limits": "No (25MB free)",
      "No ads": "No",
      "Open source": "No",
      "Self-hostable": "No",
      "Files processed privately": "No (files uploaded to their servers)",
      "No watermarks on free tier": "Limited",
      "107 tools (PDF, Image, Video, Dev)": "No (PDF only)",
      "Works offline / client-side tools": "No",
      "JSON-LD structured data": "Yes",
      "API available": "Yes (paid)",
    },
  },
  smallpdf: {
    name: "Smallpdf",
    slug: "smallpdf",
    tagline: "Swiss PDF tool with aggressive upsells",
    toolCount: "30+ (PDF + AI)",
    pricing: "$9/mo Pro",
    freeLimit: "2 tasks/day",
    openSource: false,
    selfHostable: false,
    cloudUploads: true,
    features: {
      "Free to use": "Limited (2 tasks/day)",
      "No account required": "No",
      "No file size limits": "No",
      "No ads": "No",
      "Open source": "No",
      "Self-hostable": "No",
      "Files processed privately": "No (files uploaded to their servers)",
      "No watermarks on free tier": "Limited",
      "107 tools (PDF, Image, Video, Dev)": "No (21 tools, PDF only)",
      "Works offline / client-side tools": "No",
      "Desktop app included": "Yes (paid)",
      "API available": "Yes (paid)",
    },
  },
  "adobe-acrobat": {
    name: "Adobe Acrobat Online",
    slug: "adobe-acrobat",
    tagline: "Industry standard with expensive subscription",
    toolCount: "20+ (PDF)",
    pricing: "$23/mo Pro",
    freeLimit: "Very limited",
    openSource: false,
    selfHostable: false,
    cloudUploads: true,
    features: {
      "Free to use": "Very limited",
      "No account required": "No (Adobe ID required)",
      "No file size limits": "No",
      "No ads": "Yes",
      "Open source": "No",
      "Self-hostable": "No",
      "Files processed privately": "No (Adobe cloud)",
      "No watermarks on free tier": "Limited",
      "107 tools (PDF, Image, Video, Dev)": "No (PDF only)",
      "Works offline / client-side tools": "Desktop app (paid)",
      "E-signatures": "Yes (paid)",
      "API available": "Yes (paid)",
    },
  },
  sejda: {
    name: "Sejda PDF",
    slug: "sejda",
    tagline: "PDF editor with 3 task/hour and file size limits",
    toolCount: "~35 (PDF)",
    pricing: "$7.50/mo Pro",
    freeLimit: "3 tasks/hour, 50 MB",
    openSource: false,
    selfHostable: false,
    cloudUploads: true,
    features: {
      "Free to use": "Limited (3 tasks/hour)",
      "No account required": "No",
      "No file size limits": "No (50MB free)",
      "No ads": "No",
      "Open source": "No",
      "Self-hostable": "No",
      "Files processed privately": "No (files uploaded to their servers)",
      "No watermarks on free tier": "Yes",
      "107 tools (PDF, Image, Video, Dev)": "No (PDF only)",
      "Works offline / client-side tools": "No",
      "Desktop app included": "No",
      "API available": "Yes (paid)",
    },
  },
  pdf24: {
    name: "PDF24",
    slug: "pdf24",
    tagline: "Free PDF tool suite — but not open source",
    toolCount: "95+ (PDF only)",
    pricing: "Free (ad-supported)",
    freeLimit: "Generous",
    openSource: false,
    selfHostable: false,
    cloudUploads: true,
    features: {
      "Free to use": "Yes",
      "No account required": "Yes",
      "No file size limits": "Limited",
      "No ads": "No",
      "Open source": "No",
      "Self-hostable": "No",
      "Files processed privately": "No (files uploaded to their servers)",
      "No watermarks on free tier": "Yes",
      "107 tools (PDF, Image, Video, Dev)": "No (PDF only)",
      "Works offline / client-side tools": "No",
      "Desktop app included": "Yes (Windows)",
      "API available": "No",
    },
  },
  foxit: {
    name: "Foxit PDF",
    slug: "foxit",
    tagline: "Enterprise PDF suite with paid subscription",
    toolCount: "15+ (PDF + e-sign)",
    pricing: "$14/mo Cloud",
    freeLimit: "Very limited",
    openSource: false,
    selfHostable: false,
    cloudUploads: true,
    features: {
      "Free to use": "No (paid subscription)",
      "No account required": "No",
      "No file size limits": "No",
      "No ads": "Yes",
      "Open source": "No",
      "Self-hostable": "Enterprise only",
      "Files processed privately": "No (Foxit cloud)",
      "No watermarks on free tier": "N/A (no free tier)",
      "107 tools (PDF, Image, Video, Dev)": "No (PDF only)",
      "Works offline / client-side tools": "Desktop app (paid)",
      "E-signatures": "Yes (paid)",
      "API available": "Yes (paid)",
    },
  },
  lightpdf: {
    name: "LightPDF",
    slug: "lightpdf",
    tagline: "Freemium PDF tools with AI features behind paywall",
    toolCount: "~20 (PDF + AI)",
    pricing: "$10/mo Premium",
    freeLimit: "Limited",
    openSource: false,
    selfHostable: false,
    cloudUploads: true,
    features: {
      "Free to use": "Limited",
      "No account required": "No",
      "No file size limits": "No",
      "No ads": "No",
      "Open source": "No",
      "Self-hostable": "No",
      "Files processed privately": "No (files uploaded to their servers)",
      "No watermarks on free tier": "Limited",
      "107 tools (PDF, Image, Video, Dev)": "No (PDF + basic image)",
      "Works offline / client-side tools": "No",
      "Desktop app included": "No",
      "API available": "Yes (paid)",
    },
  },
  "stirling-pdf": {
    name: "Stirling PDF",
    slug: "stirling-pdf",
    tagline: "Open-source self-hosted PDF suite (Docker only)",
    toolCount: "~50 (PDF only)",
    pricing: "Free (self-host)",
    freeLimit: "No demo",
    openSource: true,
    selfHostable: true,
    cloudUploads: false,
    features: {
      "Free to use": "Yes",
      "No account required": "Yes (self-hosted)",
      "No file size limits": "Depends on your server",
      "No ads": "Yes",
      "Open source": "Yes (GPL-3.0)",
      "Self-hostable": "Yes (Docker required)",
      "Files processed privately": "Yes (your own server)",
      "No watermarks on free tier": "Yes",
      "107 tools (PDF, Image, Video, Dev)": "No (PDF only)",
      "Works offline / client-side tools": "No (server-side only)",
      "Desktop app included": "No",
      "API available": "Yes (self-hosted)",
    },
  },
  dochub: {
    name: "DocHub",
    slug: "dochub",
    tagline: "Document signing and editing platform",
    toolCount: "Form-fill / e-sign",
    pricing: "$7/mo Pro",
    freeLimit: "5 docs/mo",
    openSource: false,
    selfHostable: false,
    cloudUploads: true,
    features: {
      "Free to use": "Limited (1 user, 5 docs/month)",
      "No account required": "No",
      "No file size limits": "No",
      "No ads": "Yes",
      "Open source": "No",
      "Self-hostable": "No",
      "Files processed privately": "No (DocHub cloud)",
      "No watermarks on free tier": "Yes",
      "107 tools (PDF, Image, Video, Dev)": "No (document editing only)",
      "Works offline / client-side tools": "No",
      "E-signatures": "Yes (limited free)",
      "API available": "Yes (paid)",
    },
  },
  pdfescape: {
    name: "PDFescape",
    slug: "pdfescape",
    tagline: "Free online PDF editor with basic tools",
    toolCount: "~15 (basic)",
    pricing: "$3/mo Premium",
    freeLimit: "10 MB, 100 pages",
    openSource: false,
    selfHostable: false,
    cloudUploads: true,
    features: {
      "Free to use": "Limited (10MB, 100 pages)",
      "No account required": "Yes (online version)",
      "No file size limits": "No (10MB limit free)",
      "No ads": "No",
      "Open source": "No",
      "Self-hostable": "No",
      "Files processed privately": "No (uploaded to their servers)",
      "No watermarks on free tier": "Yes",
      "107 tools (PDF, Image, Video, Dev)": "No (basic PDF editing only)",
      "Works offline / client-side tools": "No",
      "Desktop app included": "Yes (Windows, paid)",
      "API available": "No",
    },
  },
  "nitro-pdf": {
    name: "Nitro PDF",
    slug: "nitro-pdf",
    tagline: "Business PDF suite with paid subscription",
    toolCount: "PDF + e-sign",
    pricing: "$129/yr Pro",
    freeLimit: "14-day trial",
    openSource: false,
    selfHostable: false,
    cloudUploads: true,
    features: {
      "Free to use": "No (paid, 14-day trial only)",
      "No account required": "No",
      "No file size limits": "No",
      "No ads": "Yes",
      "Open source": "No",
      "Self-hostable": "No",
      "Files processed privately": "No (Nitro cloud)",
      "No watermarks on free tier": "N/A (no free tier)",
      "107 tools (PDF, Image, Video, Dev)": "No (PDF + e-sign only)",
      "Works offline / client-side tools": "Desktop app (paid)",
      "E-signatures": "Yes (paid)",
      "API available": "Yes (paid)",
    },
  },
};

const privatoolsFeatures: Record<string, boolean | string> = {
  "Free to use": "Yes — 100% free",
  "No account required": "Yes",
  "No file size limits": "500MB per file",
  "No ads": "Yes",
  "Open source": "Yes (MIT license)",
  "Self-hostable": "Yes (Docker)",
  "Files processed privately": "Yes — deleted immediately",
  "No watermarks on free tier": "Yes",
  "107 tools (PDF, Image, Video, Dev)": "Yes",
  "Works offline / client-side tools": "Yes (dev tools)",
  "JSON-LD structured data": "Yes",
  "Desktop app included": "PWA installable",
  "E-signatures": "Yes (free)",
  "API available": "Coming soon",
};

function FeatureCell({ value }: { value: boolean | string }) {
  if (value === true || value === "Yes") {
    return <span className="inline-flex items-center gap-1 text-green-600 font-semibold text-sm"><Check className="w-4 h-4" /> Yes</span>;
  }
  if (value === false || value === "No") {
    return <span className="inline-flex items-center gap-1 text-red-500 text-sm"><X className="w-4 h-4" /> No</span>;
  }
  const isPositive = typeof value === "string" && (value.startsWith("Yes") || value === "500MB per file" || value.startsWith("PWA"));
  return <span className={`text-sm ${isPositive ? "text-green-600 font-semibold" : "text-muted-foreground"}`}>{value as string}</span>;
}

export default function ComparePage() {
  const { competitor } = useParams<{ competitor: string }>();
  const comp = competitor ? competitors[competitor] : null;

  if (!comp) {
    const allCompetitors = Object.entries(competitors);
    return (
      <div className="min-h-screen bg-background text-foreground">
        <EditorialMasthead />
        <main className="mx-auto max-w-6xl px-4 sm:px-6 py-10 sm:py-14">
          {/* Hero */}
          <header className="mb-12 max-w-3xl">
            <div className="flex items-center gap-3 mb-4">
              <span className="section-flag">HONEST COMPARISONS</span>
              <span className="font-mono-meta text-[11px] text-muted-foreground">{allCompetitors.length} competitors · last updated May 2026</span>
            </div>
            <h1 className="font-heading text-4xl sm:text-6xl font-black text-foreground leading-[1.05] tracking-tight">
              PrivaTools&nbsp;<span className="text-muted-foreground">vs</span>{" "}
              <span className="text-accent">everyone&nbsp;else.</span>
            </h1>
            <p className="font-serif-body text-base sm:text-lg text-muted-foreground mt-5 leading-relaxed">
              Direct, no-spin comparisons against every major PDF and file tool. We tell you when a competitor wins — and which ones charge for features we give away free.
            </p>
          </header>

          {/* At-a-glance summary */}
          <section className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-12">
            {[
              { icon: DollarSign, label: "Truly free", value: "Yes — no quotas", color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/25" },
              { icon: Lock, label: "Open source", value: "MIT licensed", color: "text-blue-400 bg-blue-500/10 border-blue-500/25" },
              { icon: ServerCog, label: "Self-hostable", value: "Yes — Docker", color: "text-violet-400 bg-violet-500/10 border-violet-500/25" },
              { icon: Zap, label: "Tools", value: "152+ all categories", color: "text-amber-400 bg-amber-500/10 border-amber-500/25" },
            ].map((s, i) => {
              const Icon = s.icon;
              return (
                <div key={i} className={cn("rounded-xl border p-4", s.color)}>
                  <Icon size={16} />
                  <p className="mt-2 font-mono-meta text-[10px] uppercase tracking-wider text-foreground/70">{s.label}</p>
                  <p className="mt-0.5 font-heading text-sm font-bold text-foreground">{s.value}</p>
                </div>
              );
            })}
          </section>

          {/* Quick at-a-glance matrix */}
          <section className="rounded-2xl border border-border bg-card p-6 sm:p-8 mb-12">
            <h2 className="font-heading text-xl sm:text-2xl font-bold text-foreground mb-1">Quick answer matrix</h2>
            <p className="font-serif-body text-sm text-muted-foreground mb-5">Open source · Self-hostable · Truly free · Files private. Sortable by what matters to you.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 pr-4 font-mono-meta text-[10px] uppercase tracking-wider text-muted-foreground">Tool</th>
                    <th className="text-center py-2 px-2 font-mono-meta text-[10px] uppercase tracking-wider text-muted-foreground">Free</th>
                    <th className="text-center py-2 px-2 font-mono-meta text-[10px] uppercase tracking-wider text-muted-foreground">Open src</th>
                    <th className="text-center py-2 px-2 font-mono-meta text-[10px] uppercase tracking-wider text-muted-foreground">Self-host</th>
                    <th className="text-center py-2 px-2 font-mono-meta text-[10px] uppercase tracking-wider text-muted-foreground">Private</th>
                    <th className="text-right py-2 pl-4 font-mono-meta text-[10px] uppercase tracking-wider text-muted-foreground">Tools</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-border/60 bg-accent/[0.04]">
                    <td className="py-3 pr-4 font-heading font-bold text-foreground">PrivaTools <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded bg-accent/15 text-accent text-[9px] font-bold">US</span></td>
                    <td className="text-center px-2"><Check size={14} className="inline text-emerald-500" /></td>
                    <td className="text-center px-2"><Check size={14} className="inline text-emerald-500" /></td>
                    <td className="text-center px-2"><Check size={14} className="inline text-emerald-500" /></td>
                    <td className="text-center px-2"><Check size={14} className="inline text-emerald-500" /></td>
                    <td className="text-right pl-4 font-mono-meta text-[12px] text-foreground">152+</td>
                  </tr>
                  {allCompetitors.map(([key, c]) => (
                    <tr key={key} className="border-b border-border/40 hover:bg-secondary/20">
                      <td className="py-3 pr-4">
                        <Link to={`/compare/${key}`} className="font-heading font-semibold text-foreground hover:text-accent transition-colors">{c.name}</Link>
                      </td>
                      <td className="text-center px-2">{c.pricing?.toLowerCase().startsWith("free") ? <Check size={14} className="inline text-emerald-500" /> : <X size={14} className="inline text-muted-foreground/60" />}</td>
                      <td className="text-center px-2">{c.openSource ? <Check size={14} className="inline text-emerald-500" /> : <X size={14} className="inline text-muted-foreground/60" />}</td>
                      <td className="text-center px-2">{c.selfHostable ? <Check size={14} className="inline text-emerald-500" /> : <X size={14} className="inline text-muted-foreground/60" />}</td>
                      <td className="text-center px-2">{!c.cloudUploads ? <Check size={14} className="inline text-emerald-500" /> : <X size={14} className="inline text-muted-foreground/60" />}</td>
                      <td className="text-right pl-4 font-mono-meta text-[12px] text-muted-foreground">{c.toolCount || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Detailed per-competitor cards */}
          <section className="mb-8">
            <h2 className="font-heading text-xl sm:text-2xl font-bold text-foreground mb-1">Pick a head-to-head comparison</h2>
            <p className="font-serif-body text-sm text-muted-foreground mb-6">Each page is a full feature-by-feature breakdown plus pricing, free-tier limits, and our honest verdict.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {allCompetitors.map(([key, c]) => (
                <Link
                  key={key}
                  to={`/compare/${key}`}
                  className="group flex flex-col rounded-xl border border-border bg-card p-5 hover:border-foreground/30 hover:translate-y-[-2px] transition-all"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-heading text-lg font-bold text-foreground group-hover:text-accent transition-colors">vs {c.name}</h3>
                      <p className="font-serif-body text-[12px] text-muted-foreground mt-1 leading-snug">{c.tagline}</p>
                    </div>
                  </div>
                  <div className="space-y-1.5 mt-3 mb-4">
                    <div className="flex items-center gap-1.5 text-[11px] font-mono-meta">
                      <DollarSign size={11} className="text-muted-foreground" />
                      <span className="text-foreground">{c.pricing || "Paid"}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] font-mono-meta">
                      <Zap size={11} className="text-muted-foreground" />
                      <span className="text-muted-foreground">Free: {c.freeLimit || "limited"}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] font-mono-meta">
                      {c.cloudUploads ? <Cloud size={11} className="text-amber-400" /> : <Lock size={11} className="text-emerald-400" />}
                      <span className="text-muted-foreground">{c.cloudUploads ? "Files uploaded to their cloud" : "Self-hosted only"}</span>
                    </div>
                  </div>
                  <div className="flex items-center flex-wrap gap-1.5 mt-auto pt-3 border-t border-border/60">
                    {c.openSource && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/25 text-blue-400 text-[10px] font-medium">
                        <Lock size={9} /> Open source
                      </span>
                    )}
                    {c.selfHostable && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-500/10 border border-violet-500/25 text-violet-400 text-[10px] font-medium">
                        <ServerCog size={9} /> Self-host
                      </span>
                    )}
                    {!c.openSource && !c.cloudUploads && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary border border-border text-muted-foreground text-[10px] font-medium">
                        <EyeOff size={9} /> Closed source
                      </span>
                    )}
                    {c.cloudUploads && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/25 text-amber-400 text-[10px] font-medium">
                        <Eye size={9} /> Sees your files
                      </span>
                    )}
                    <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-mono-meta text-primary">
                      Compare <ArrowRight size={11} className="group-hover:translate-x-0.5 transition-transform" />
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </section>

          {/* Why PrivaTools value-prop */}
          <section className="mt-16 rounded-2xl border border-border bg-card p-8 sm:p-10">
            <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-8">
              <div>
                <span className="section-flag">WHY US</span>
                <h2 className="font-heading text-2xl sm:text-3xl font-bold text-foreground mt-3 leading-tight">
                  Everything they make you pay for — for free.
                </h2>
                <p className="font-serif-body text-sm text-muted-foreground mt-4 leading-relaxed">
                  PrivaTools combines 152+ file tools across PDF, image, video, audio, and developer utilities. The whole stack is MIT-licensed and self-hostable.
                </p>
                <Link to="/" className="mt-6 inline-flex items-center gap-2 btn-editorial">
                  Browse all 152 tools <ArrowRight size={14} />
                </Link>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  { icon: Lock, title: "True Privacy", desc: "Files are processed in an isolated container and deleted immediately after the response. No 2-hour retention." },
                  { icon: Heart, title: "Actually Free", desc: "No \"2 tasks/day\" limits, no premium upsells, no watermarks, no account ever required." },
                  { icon: Globe, title: "Open Source", desc: "MIT-licensed. Audit every line of the source. Self-host on your own Docker if you don't trust anybody." },
                  { icon: Zap, title: "152 Tools", desc: "PDF, image, video, audio, and developer utilities — including browser-side AI for summarization and smart redaction." },
                ].map((item, i) => {
                  const Icon = item.icon;
                  return (
                    <div key={i} className="rounded-xl border border-border bg-background/50 p-4">
                      <Icon className="w-4 h-4 text-accent" />
                      <h3 className="font-heading font-bold text-sm mt-2 text-foreground">{item.title}</h3>
                      <p className="font-serif-body text-[12px] text-muted-foreground leading-relaxed mt-1">{item.desc}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        </main>
        <EditorialFooter />
      </div>
    );
  }

  // Combine all features from both
  const allFeatures = [...new Set([...Object.keys(comp.features), ...Object.keys(privatoolsFeatures)])];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <EditorialMasthead />

      <main className="max-w-4xl mx-auto px-4 py-12 space-y-12">
        {/* Hero */}
        <header className="text-center space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-accent/30 text-xs font-mono uppercase tracking-widest text-accent">
            <Shield className="w-3.5 h-3.5" /> Honest Comparison
          </div>
          <h1 className="text-3xl md:text-4xl font-bold leading-tight">
            PrivaTools vs {comp.name}
          </h1>
          <p className="text-base text-muted-foreground max-w-xl mx-auto">
            A side-by-side comparison of features, pricing, and privacy practices.
          </p>
        </header>

        {/* Comparison Table */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b-2 border-accent">
                <th className="py-3 pr-4 font-mono text-xs uppercase tracking-wider text-muted-foreground">Feature</th>
                <th className="py-3 px-4 font-mono text-xs uppercase tracking-wider text-accent">PrivaTools</th>
                <th className="py-3 pl-4 font-mono text-xs uppercase tracking-wider text-muted-foreground">{comp.name}</th>
              </tr>
            </thead>
            <tbody>
              {allFeatures.map((feature, i) => (
                <tr key={feature} className={`border-b border-border ${i % 2 === 0 ? "" : "bg-card-tint/30"}`}>
                  <td className="py-3 pr-4 text-sm font-medium">{feature}</td>
                  <td className="py-3 px-4">
                    <FeatureCell value={privatoolsFeatures[feature] ?? false} />
                  </td>
                  <td className="py-3 pl-4">
                    <FeatureCell value={comp.features[feature] ?? false} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Why PrivaTools */}
        <section className="space-y-6">
          <h2 className="text-2xl font-bold border-b-2 border-accent pb-2 inline-block">
            Why Choose PrivaTools?
          </h2>
          <div className="grid sm:grid-cols-2 gap-4">
            {[
              { icon: Lock, title: "True Privacy", desc: "Files are processed and immediately deleted. No cloud storage, no data mining." },
              { icon: Heart, title: "Actually Free", desc: "No '2 tasks/day' limits, no premium upsells, no watermarks. Every tool, every time." },
              { icon: Globe, title: "Open Source", desc: "MIT licensed. Audit every line of code. Self-host with Docker if you don't trust anybody." },
              { icon: Zap, title: "107 Tools", desc: "Not just PDF — image, video, audio, and developer tools too. All in one place." },
            ].map((item, i) => (
              <div key={i} className="p-4 border border-border rounded-lg space-y-2">
                <div className="flex items-center gap-2">
                  <item.icon className="w-4 h-4 text-accent" />
                  <h3 className="font-bold text-sm">{item.title}</h3>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="text-center space-y-4 py-8 border-t border-border">
          <h2 className="text-2xl font-bold">Try PrivaTools — it's free</h2>
          <div className="flex flex-wrap justify-center gap-3">
            <Link
              to="/"
              className="inline-flex items-center gap-2 px-6 py-3 bg-accent text-accent-foreground rounded-md font-mono text-sm font-semibold hover:opacity-90 transition-opacity"
            >
              Browse All Tools <ArrowRight className="w-4 h-4" />
            </Link>
            <a
              href="https://github.com/taiyeba-dg/privatools"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-6 py-3 border border-border rounded-md font-mono text-sm hover:border-accent/40 transition-colors"
            >
              <Github className="w-4 h-4" /> View Source
            </a>
          </div>
        </section>

        {/* Other comparisons */}
        <section className="text-center pb-4">
          <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-3">Other comparisons</p>
          <div className="flex flex-wrap justify-center gap-2">
            {Object.entries(competitors)
              .filter(([key]) => key !== competitor)
              .map(([key, c]) => (
                <Link
                  key={key}
                  to={`/compare/${key}`}
                  className="px-3 py-1.5 text-xs border border-border rounded-md hover:border-accent/40 transition-colors"
                >
                  vs {c.name}
                </Link>
              ))}
          </div>
        </section>
      </main>

      <EditorialFooter />
    </div>
  );
}
