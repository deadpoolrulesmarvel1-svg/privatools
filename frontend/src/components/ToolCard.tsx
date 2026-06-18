import { LucideIcon, Star } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Category } from "@/data/tools";
import { prefetchRoute, loadToolPage } from "@/lib/prefetch";
import { useFavorites } from "@/hooks/useFavorites";

interface ToolCardProps {
  slug: string;
  icon: LucideIcon;
  name: string;
  description: string;
  category: Category;
}

const categoryConfig: Record<Category, { icon: string; bg: string; glow: string }> = {
  organize:   { icon: "text-blue-400",    bg: "bg-blue-500/10",    glow: "hover:border-blue-500/30 hover:shadow-[0_0_20px_-4px_hsl(217_90%_60%/0.25)]" },
  edit:       { icon: "text-violet-400",  bg: "bg-violet-500/10",  glow: "hover:border-violet-500/30 hover:shadow-[0_0_20px_-4px_hsl(263_70%_65%/0.25)]" },
  optimize:   { icon: "text-teal-400",    bg: "bg-teal-500/10",    glow: "hover:border-teal-500/30 hover:shadow-[0_0_20px_-4px_hsl(174_60%_50%/0.25)]" },
  security:   { icon: "text-rose-400",    bg: "bg-rose-500/10",    glow: "hover:border-rose-500/30 hover:shadow-[0_0_20px_-4px_hsl(0_72%_60%/0.25)]" },
  "to-pdf":   { icon: "text-emerald-400", bg: "bg-emerald-500/10", glow: "hover:border-emerald-500/30 hover:shadow-[0_0_20px_-4px_hsl(152_60%_50%/0.25)]" },
  "from-pdf": { icon: "text-amber-400",   bg: "bg-amber-500/10",   glow: "hover:border-amber-500/30 hover:shadow-[0_0_20px_-4px_hsl(38_90%_55%/0.25)]" },
  advanced:   { icon: "text-indigo-400",  bg: "bg-indigo-500/10",  glow: "hover:border-indigo-500/30 hover:shadow-[0_0_20px_-4px_hsl(239_70%_60%/0.25)]" },
};

export function ToolCard({ slug, icon: Icon, name, description, category }: ToolCardProps) {
  const cfg = categoryConfig[category];
  const { toggle, isFavorite } = useFavorites();
  const favorite = isFavorite(slug);
  // Warm the ToolPage shell on hover so click-to-render is near-instant.
  // Per-tool UI chunks (CompressUI, MergeUI, etc.) still load on demand
  // inside ToolPage — this only fetches the route shell once.
  const prefetch = () => prefetchRoute(loadToolPage);
  return (
    <Link
      to={`/tool/${slug}`}
      onMouseEnter={prefetch}
      onFocus={prefetch}
      onTouchStart={prefetch}
      className={cn(
        "group flex flex-col items-start gap-3.5 rounded-xl border border-border bg-card p-4 text-left",
        // Workshop-paper feel: subtle lift + soft drop shadow on hover, never iOS-glossy.
        "transition-all duration-200 ease-[cubic-bezier(0.16,0.84,0.44,1)]",
        "hover:-translate-y-0.5 hover:shadow-[0_4px_18px_rgba(0,0,0,0.06)] dark:hover:shadow-[0_4px_18px_rgba(0,0,0,0.4)] w-full",
        cfg.glow
      )}
    >
      <div className="flex w-full items-start justify-between gap-2">
        <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg", cfg.bg)}>
          <Icon size={18} strokeWidth={1.75} className={cfg.icon} />
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            toggle(slug);
          }}
          aria-label={favorite ? `Unpin ${name}` : `Pin ${name}`}
          aria-pressed={favorite}
          title={favorite ? "Pinned to sidebar" : "Pin to sidebar"}
          className={cn(
            "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors",
            favorite
              ? "border-accent/45 bg-accent/10 text-accent"
              : "border-border bg-card text-muted-foreground/70 hover:border-accent/45 hover:text-accent",
          )}
        >
          <Star size={14} strokeWidth={1.8} fill={favorite ? "currentColor" : "none"} />
        </button>
      </div>
      <div>
        <p className="text-sm font-semibold text-foreground leading-snug">{name}</p>
        <p className="mt-1 text-xs text-muted-foreground leading-snug">{description}</p>
      </div>
    </Link>
  );
}
