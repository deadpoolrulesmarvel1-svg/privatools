import { Link, useLocation } from "react-router-dom";
import { Home, Search, Layers, GitBranch } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
    { icon: Home, label: "Home", path: "/", active: (pathname: string) => pathname === "/" },
    { icon: Search, label: "Tools", path: "search", active: (pathname: string) => pathname.startsWith("/tool/") || pathname.startsWith("/tools/") },
    { icon: Layers, label: "Batch", path: "/batch", active: (pathname: string) => pathname === "/batch" },
    { icon: GitBranch, label: "Pipeline", path: "/pipeline", active: (pathname: string) => pathname === "/pipeline" },
];

export function MobileNav() {
    const { pathname } = useLocation();

    const handleClick = (path: string) => {
        if (path === "search") {
            // Trigger command palette
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
        }
    };

    return (
        <nav
            aria-label="Mobile primary navigation"
            className={cn(
                "fixed bottom-0 inset-x-0 z-[90] lg:hidden bg-card/95 backdrop-blur-2xl border-t border-border/30 pb-[env(safe-area-inset-bottom)] shadow-[0_-10px_30px_rgba(0,0,0,0.16)]",
                "translate-y-0"
            )}
        >
            <div className="flex items-center justify-around h-16">
                {navItems.map(item => {
                    const Icon = item.icon;
                    const isSearch = item.path === "search";
                    const isActive = item.active(pathname);
                    const itemClass = cn(
                        "relative flex min-h-11 min-w-16 flex-col items-center justify-center gap-0.5 rounded-md px-3 py-1 transition-colors",
                        isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
                    );

                    if (isSearch) {
                        return (
                            <button
                                type="button"
                                key={item.label}
                                onClick={() => handleClick(item.path)}
                                className={itemClass}
                                aria-current={isActive ? "page" : undefined}
                                aria-label="Search tools"
                            >
                                <Icon size={20} strokeWidth={isActive ? 2 : 1.75} />
                                <span className={cn("text-[10px]", isActive && "font-semibold")}>{item.label}</span>
                                {isActive && (
                                    <span className="absolute top-1.5 right-3 h-1.5 w-1.5 rounded-full bg-primary" />
                                )}
                            </button>
                        );
                    }

                    return (
                        <Link
                            key={item.label}
                            to={item.path}
                            className={itemClass}
                            aria-current={isActive ? "page" : undefined}
                        >
                            <Icon
                                size={20}
                                strokeWidth={isActive ? 2 : 1.75}
                            />
                            <span className={cn("text-[10px] relative", isActive && "font-semibold")}>
                                {item.label}
                                {item.label === "Pipeline" && !isActive && (
                                    <span className="absolute -top-1 -right-2 w-1.5 h-1.5 rounded-full bg-primary" />
                                )}
                            </span>
                            {isActive && (
                                <span className="w-1 h-1 rounded-full bg-primary" />
                            )}
                        </Link>
                    );
                })}
            </div>
        </nav>
    );
}
