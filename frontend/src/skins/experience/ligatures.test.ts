import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import postcss, { type Rule } from "postcss";
import { afterEach, describe, expect, it } from "vitest";

/*
 * Manrope, Air's text face, draws "--", "->" and "<-" as a single dash or
 * arrow through its standard ligatures (OpenType `liga`, read from
 * public/fonts/skins/manrope-400-ed60e9e8.*.woff2 with fontTools), so a guide
 * answer's "<!-- page 3 -->" read "<!– page 3 –>" and SQL Formatter's "--
 * line comments" lost a hyphen. Its contextual alternates (`calt`) only raise
 * punctuation between capitals and stay on. Play's Outfit has no such
 * ligature. jsdom draws no text, so these tests read every stylesheet and
 * check the declarations that reach the elements; the browser check compares
 * the pixels.
 */
const SRC = resolve(__dirname, "../..");
const sheets = readdirSync(SRC, { recursive: true, encoding: "utf8" })
  .filter(file => file.endsWith(".css"))
  .map(file => ({ file, root: postcss.parse(readFileSync(join(SRC, file), "utf8")) }));

/** The values of font-variant-ligatures that rules matching `element` set. */
function ligatures(element: Element): string[] {
  const values: string[] = [];
  for (const { root } of sheets) {
    root.walkDecls("font-variant-ligatures", decl => {
      const rule = decl.parent as Rule;
      if (rule?.type !== "rule") return;
      if (rule.selectors.some(selector => { try { return element.matches(selector); } catch { return false; } })) values.push(decl.value);
    });
  }
  return values;
}

function mount(experience: "air" | "play"): void {
  document.documentElement.setAttribute("data-experience", experience);
  document.body.innerHTML = `<div class="dl-root consumer-app"><main class="pt-main"><section class="ts-guide"><p>Use &lt;!-- page 3 --&gt; to mark a page.</p></section>
    <input value="a -- b"><textarea>-- a line comment</textarea><select><option>-&gt;</option></select><button>&lt;- back</button>
    <code>a -- b</code><kbd>--</kbd><samp>-&gt;</samp><pre>-- SQL</pre></main></div>`;
}

afterEach(() => {
  document.documentElement.removeAttribute("data-experience");
  document.body.innerHTML = "";
});

describe("ligatures that change what a reader sees", () => {
  it("are off for Air's running text, which inherits from the page", () => {
    mount("air");
    expect(ligatures(document.documentElement)).toContain("no-common-ligatures");
    // Nothing between the page and a guide paragraph turns them back on.
    for (let node: Element | null = document.querySelector(".ts-guide p"); node && node !== document.documentElement; node = node.parentElement) {
      expect(ligatures(node), node.tagName).toEqual([]);
    }
  });

  it("are off in Air's form fields, which take their font from the browser, not the page", () => {
    mount("air");
    for (const selector of ["input", "textarea", "select", "button"]) {
      expect(ligatures(document.querySelector(selector)!), selector).toContain("no-common-ligatures");
    }
  });

  it("stay on in Play, whose Outfit joins only fi, fl and the like", () => {
    mount("play");
    expect(ligatures(document.documentElement)).toEqual([]);
    expect(ligatures(document.querySelector("input")!)).toEqual([]);
  });

  it("are all off in code, on every page", () => {
    for (const experience of ["air", "play"] as const) {
      mount(experience);
      for (const selector of ["code", "kbd", "samp", "pre"]) {
        expect(ligatures(document.querySelector(selector)!), `${experience} ${selector}`).toContain("none");
      }
    }
  });
});
