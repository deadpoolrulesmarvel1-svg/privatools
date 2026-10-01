import type { SparkleFit } from "./png-job";

/** Where the logo sat, in sizes and distances rather than versions: "48 px logo, 96 px from the corner". */
export function placeLabel(fit: SparkleFit): string {
    const where = fit.marginRight === fit.marginBottom
        ? `${fit.marginRight} px from the corner`
        : `${fit.marginRight} px from the right and ${fit.marginBottom} px from the bottom`;
    return `${fit.size} px logo, ${where}`;
}
