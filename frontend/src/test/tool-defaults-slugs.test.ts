/**
 * `useToolDefaults(slug, …)` keys stored settings by the tool's registry slug
 * so /my-stuff can map a stored entry back to a tool name. A typo silently
 * produces an orphan entry that maps to nothing, which is invisible until a
 * user opens /my-stuff and sees a setting for a tool that doesn't exist.
 *
 * This guards the whole 104-tool sweep: adding the hook with a wrong slug fails
 * here rather than shipping.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tools } from "@/data/tools";
import { nonPdfTools } from "@/data/non-pdf-tools";

const SRC = join(process.cwd(), "src");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return e.name.endsWith(".tsx") || e.name.endsWith(".ts") ? [full] : [];
  });
}

function usages(): { file: string; slug: string }[] {
  const out: { file: string; slug: string }[] = [];
  for (const file of walk(SRC)) {
    if (file.includes(".test.")) continue;
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/useToolDefaults\(\s*["'`]([^"'`]+)["'`]/g)) {
      out.push({ file: file.slice(SRC.length + 1), slug: m[1] });
    }
  }
  return out;
}

const known = new Set([...tools.map((t) => t.slug), ...nonPdfTools.map((t) => t.slug)]);

describe("useToolDefaults slugs", () => {
  it("finds the hook in use", () => {
    expect(usages().length).toBeGreaterThan(0);
  });

  it("every slug is a real registry slug", () => {
    const bad = usages().filter((u) => !known.has(u.slug));
    expect(bad.map((u) => `${u.file}: "${u.slug}"`)).toEqual([]);
  });

  it("no two tools share a slug", () => {
    const seen = new Map<string, string[]>();
    for (const u of usages()) {
      seen.set(u.slug, [...(seen.get(u.slug) ?? []), u.file]);
    }
    const dupes = [...seen.entries()].filter(([, files]) => files.length > 1);
    expect(dupes.map(([slug, files]) => `${slug}: ${files.join(", ")}`)).toEqual([]);
  });

  it("useFormPersist is fully retired in favour of useToolDefaults", () => {
    // useToolDefaults wraps useFormPersist; nothing else should call it
    // directly, or its settings won't show up in /my-stuff.
    const direct = walk(SRC).filter((f) => {
      if (f.includes(".test.") || f.endsWith(join("hooks", "useToolDefaults.ts"))) return false;
      if (f.endsWith(join("hooks", "useFormPersist.ts"))) return false;
      return readFileSync(f, "utf8").includes("useFormPersist(");
    });
    expect(direct.map((f) => f.slice(SRC.length + 1))).toEqual([]);
  });
});
