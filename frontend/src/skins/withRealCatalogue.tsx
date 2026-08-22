/* eslint-disable */
// @ts-nocheck
/**
 * Makes a design's slug lookups safe against the real registry.
 *
 * Each design hardcodes sample slugs in places its own sample catalogue
 * satisfied — Aurora's showcase looks up `organise-pdf`, which does not exist
 * here (ours is `organize-pages`). Swapping in the real 219-tool registry turns
 * every one of those into `undefined.name` and takes the whole app down, since
 * the lookup happens inside renderVals rather than in a route nobody visits.
 *
 * Patching the individual slugs would be whack-a-mole across three designs. The
 * lookup itself returns a placeholder instead, so an unknown slug renders as an
 * unremarkable row rather than crashing — which is also the right behaviour if
 * a tool is ever removed from the registry.
 */

/** Shaped to satisfy every field the three designs read off a tool record. */
function placeholder(rawSlug) {
    // The designs call these lookups with `null` while no tool is selected, so
    // a placeholder built straight from the argument hands back a null `name`
    // and the next `.toLowerCase()` throws just as loudly as the original bug.
    const slug = String(rawSlug ?? "unknown-tool");
    return {
        slug, name: slug, fam: "PDF", family: "PDF", subfamily: "Advanced",
        runs: "server", mode: "server",
        desc: "", description: "", purpose: "",
        icon: "help", tasks: [], task: "Advanced", syn: "",
        inputs: ["Any"], outputs: ["Any"], input: "ANY", output: "ANY",
        popular: false,
    };
}

export function withRealCatalogue(Base, config = {}) {
    return class WithRealCatalogue extends Base {
        constructor(props) {
            super(props);

            // Each design gates processing-mode claims behind a "registry
            // loaded" flag, and normalises every record to `unverified` while
            // it is false. That was correct for their sample data, which had no
            // sourced modes — it is not correct now: `clientOnly` is recorded
            // per tool in the real registry, so the mode is known.
            //
            // The flag has to be set *after* super(), which is when the design
            // normalises its records, so the records are normalised again.
            if (config.meta) {
                this.catalogueMeta = { ...this.catalogueMeta, ...config.meta };
            }
            if (config.records && typeof this.normalizeRecord === "function") {
                this.catalogue = config.records.map((r) => this.normalizeRecord(r));
            }
        }

        toolBySlug(slug) {
            if (!super.toolBySlug) return placeholder(slug);
            return super.toolBySlug(slug) || placeholder(slug);
        }

        /** Structured names the same lookup `byslug`. */
        byslug(slug) {
            if (!super.byslug) return placeholder(slug);
            return super.byslug(slug) || placeholder(slug);
        }
    };
}
