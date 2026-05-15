import { Link } from "react-router-dom";
import { Home } from "lucide-react";
import { cn } from "@/lib/utils";

interface BreadcrumbProps {
    items: { label: string; href?: string }[];
}

export function Breadcrumb({ items }: BreadcrumbProps) {
    return (
        <nav className="flex items-center gap-1 text-[12px] text-muted-foreground/80 mb-4 flex-wrap border-l-2 border-primary/20 pl-3">
            <Link to="/" className="flex items-center gap-1 hover:text-primary transition-colors">
                <Home size={11} />
                <span>Home</span>
            </Link>
            {items.map((item, i) => {
                const isLast = i === items.length - 1;
                return (
                    <span key={i} className="flex items-center gap-1">
                        <span className="text-muted-foreground/85">/</span>
                        {item.href ? (
                            <Link to={item.href} className="text-muted-foreground hover:text-primary transition-colors">{item.label}</Link>
                        ) : (
                            <span className={cn(
                                "font-medium",
                                isLast ? "text-foreground font-heading" : "text-foreground/70"
                            )}>{item.label}</span>
                        )}
                    </span>
                );
            })}
        </nav>
    );
}

