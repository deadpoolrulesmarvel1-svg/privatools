#!/usr/bin/env node

const DEFAULT_BASE_URL = "https://privatools.me";
const SUPPORTED_PIPELINE_STEPS = new Set(["compress-pdf", "strip-metadata"]);

function printHelp() {
  process.stdout.write(`PrivaTools CLI

Usage:
  privatools --help
  privatools pipeline-url <step...> [--base-url <url>]
  privatools validate <step...>

Examples:
  privatools pipeline-url compress-pdf strip-metadata
  privatools validate compress-pdf strip-metadata

Supported pipeline steps:
  ${[...SUPPORTED_PIPELINE_STEPS].join(", ")}
`);
}

function parseBaseUrl(args) {
  const idx = args.indexOf("--base-url");
  if (idx === -1) return { baseUrl: DEFAULT_BASE_URL, args };
  const baseUrl = args[idx + 1];
  if (!baseUrl) {
    throw new Error("--base-url needs a URL");
  }
  const nextArgs = [...args.slice(0, idx), ...args.slice(idx + 2)];
  return { baseUrl: baseUrl.replace(/\/+$/, ""), args: nextArgs };
}

function encodePipeline(steps) {
  const payload = JSON.stringify({ version: 1, steps });
  return Buffer.from(payload, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function validateSteps(steps) {
  if (steps.length === 0) {
    throw new Error("Provide at least one pipeline step");
  }
  const unsupported = steps.filter((step) => !SUPPORTED_PIPELINE_STEPS.has(step));
  if (unsupported.length > 0) {
    throw new Error(
      `Unsupported step(s): ${unsupported.join(", ")}. Supported: ${[...SUPPORTED_PIPELINE_STEPS].join(", ")}`
    );
  }
}

function main(argv) {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h" || command === "help") {
    printHelp();
    return 0;
  }

  if (command === "validate") {
    validateSteps(rest);
    process.stdout.write(JSON.stringify({ ok: true, steps: rest }, null, 2) + "\n");
    return 0;
  }

  if (command === "pipeline-url") {
    const parsed = parseBaseUrl(rest);
    validateSteps(parsed.args);
    const url = new URL("/pipeline", parsed.baseUrl);
    url.searchParams.set("p", encodePipeline(parsed.args));
    process.stdout.write(url.toString() + "\n");
    return 0;
  }

  throw new Error(`Unknown command: ${command}`);
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`privatools: ${error.message}\n`);
  process.exitCode = 1;
}
