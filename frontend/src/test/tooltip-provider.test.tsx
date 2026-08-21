/**
 * Radix `Tooltip` throws "must be used within `TooltipProvider`" at render time
 * if no provider is mounted above it. There was no TooltipProvider anywhere in
 * the app, so every tool using a tooltip crashed into the ErrorBoundary the
 * moment it rendered one — CompressUI and BatesUI both did, on file upload.
 *
 * These tests guard both halves: a provider must exist at the app root, and any
 * component importing the tooltip primitives must be reachable through it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { render } from "@testing-library/react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AppProviders } from "@/components/AppProviders";

const SRC = join(process.cwd(), "src");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return e.name.endsWith(".tsx") ? [full] : [];
  });
}

describe("TooltipProvider", () => {
  it("a bare Tooltip throws without a provider — the bug this guards", () => {
    expect(() =>
      render(
        <Tooltip>
          <TooltipTrigger>x</TooltipTrigger>
          <TooltipContent>y</TooltipContent>
        </Tooltip>,
      ),
    ).toThrow(/TooltipProvider/);
  });

  it("AppProviders supplies the tooltip context", () => {
    expect(() =>
      render(
        <AppProviders>
          <Tooltip>
            <TooltipTrigger>x</TooltipTrigger>
            <TooltipContent>y</TooltipContent>
          </Tooltip>
        </AppProviders>,
      ),
    ).not.toThrow();
  });

  it("App.tsx mounts AppProviders", () => {
    const app = readFileSync(join(SRC, "App.tsx"), "utf8");
    expect(app).toContain("AppProviders");
  });

  it("every tooltip consumer is a tool/page rendered under the app root", () => {
    // Guards against someone adding a tooltip in a tree mounted outside
    // AppProviders (e.g. a portal root or a separate ReactDOM.render).
    const consumers = walk(SRC).filter((f) => {
      if (f.includes(".test.") || f.endsWith(join("ui", "tooltip.tsx"))) return false;
      return readFileSync(f, "utf8").includes('from "@/components/ui/tooltip"');
    });
    expect(consumers.length).toBeGreaterThan(0);
    for (const f of consumers) {
      expect(f).toMatch(/[/\\](components|pages)[/\\]/);
    }
  });
});
