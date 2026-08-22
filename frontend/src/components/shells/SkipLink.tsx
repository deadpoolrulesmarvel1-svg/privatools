/** Mirrors the static anchor in index.html so the pre-hydration and hydrated
 *  skip links resolve to the same target. Every shell renders one. */
export function SkipLink() {
    return (
        <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[200] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:font-medium focus:shadow-lg"
        >
            Skip to main content
        </a>
    );
}
