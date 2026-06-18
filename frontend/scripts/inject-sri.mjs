import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const distDir = fileURLToPath(new URL("../dist/", import.meta.url));
const indexPath = path.join(distDir, "index.html");
const CHECK_ONLY = process.argv.includes("--check");
const ASSET_TAG_RE = /<(script|link)\b([^>]*?\b(?:src|href)="([^"]+)"[^>]*)>/g;

function assetPathFromUrl(url) {
  const cleanUrl = url.split("#")[0].split("?")[0];
  if (!cleanUrl.startsWith("/assets/")) return null;
  if (!/\.(?:js|css|mjs)$/i.test(cleanUrl)) return null;
  return path.join(distDir, cleanUrl.slice(1));
}

function integrityFor(filePath) {
  const digest = createHash("sha384").update(readFileSync(filePath)).digest("base64");
  return `sha384-${digest}`;
}

function withAttribute(tag, name, value) {
  const attrRe = new RegExp(`\\s${name}(?:=(?:"[^"]*"|'[^']*'|[^\\s>]+))?`, "i");
  if (attrRe.test(tag)) {
    return tag.replace(attrRe, ` ${name}="${value}"`);
  }
  return tag.replace(/>$/, ` ${name}="${value}">`);
}

function ensureCrossorigin(tag) {
  return /\scrossorigin(?:[\s=>]|$)/i.test(tag)
    ? tag
    : tag.replace(/>$/, " crossorigin>");
}

if (!existsSync(indexPath)) {
  console.error(`[sri] missing ${indexPath}; run vite build first`);
  process.exit(1);
}

const html = readFileSync(indexPath, "utf8");
let assetCount = 0;
let mismatchCount = 0;

const nextHtml = html.replace(ASSET_TAG_RE, (tag, _tagName, _attrs, url) => {
  const filePath = assetPathFromUrl(url);
  if (!filePath) return tag;
  if (!existsSync(filePath)) {
    throw new Error(`[sri] referenced asset does not exist: ${url}`);
  }

  assetCount += 1;
  const expected = integrityFor(filePath);
  const actual = tag.match(/\sintegrity="([^"]+)"/i)?.[1] ?? null;
  if (actual !== expected) mismatchCount += 1;

  if (CHECK_ONLY) return tag;
  return ensureCrossorigin(withAttribute(tag, "integrity", expected));
});

if (assetCount === 0) {
  console.error("[sri] no JS/CSS asset tags found in dist/index.html");
  process.exit(1);
}

if (CHECK_ONLY) {
  if (mismatchCount > 0) {
    console.error(`[sri] ${mismatchCount}/${assetCount} asset tags have missing or stale integrity`);
    process.exit(1);
  }
  console.log(`[sri] verified ${assetCount} asset tags`);
} else {
  writeFileSync(indexPath, nextHtml, "utf8");
  console.log(`[sri] injected ${assetCount} asset tags`);
}
