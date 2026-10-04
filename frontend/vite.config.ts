import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import fs from "fs";
import { createHash } from "node:crypto";
import { rnnoiseWasmPlugin } from "./scripts/rnnoise-wasm.mjs";

function manualChunks(id: string): string | undefined {
  const normalized = id.split(path.sep).join("/");

  if (normalized.endsWith("/src/data/tools.ts") || normalized.endsWith("/src/data/non-pdf-tools.ts")) {
    return "tool-catalog";
  }

  if (!normalized.includes("/node_modules/")) {
    return undefined;
  }

  if (
    normalized.includes("/node_modules/react/") ||
    normalized.includes("/node_modules/react-dom/") ||
    normalized.includes("/node_modules/react-router") ||
    normalized.includes("/node_modules/@remix-run/router/")
  ) {
    return "vendor-react";
  }

  if (
    normalized.includes("/node_modules/@radix-ui/react-tooltip/") ||
    normalized.includes("/node_modules/@radix-ui/react-dialog/") ||
    normalized.includes("/node_modules/@radix-ui/react-tabs/") ||
    normalized.includes("/node_modules/@radix-ui/react-select/") ||
    normalized.includes("/node_modules/@radix-ui/react-slot/")
  ) {
    return "vendor-radix";
  }

  if (normalized.includes("/node_modules/lucide-react/")) {
    return "vendor-icons";
  }

  return undefined;
}

/** Every deployed asset graph gets a fresh offline shell and an update notice. */
function serviceWorkerVersionPlugin(): Plugin {
  let outputDirectory = path.resolve(__dirname, "dist");
  return {
    name: "privatools-service-worker-version",
    apply: "build",
    configResolved(config) {
      outputDirectory = path.resolve(config.root, config.build.outDir);
    },
    writeBundle() {
      const workerPath = path.join(outputDirectory, "sw.js");
      const worker = fs.readFileSync(workerPath, "utf8");
      const digest = createHash("sha256")
        .update(fs.readFileSync(path.join(outputDirectory, "index.html")))
        .update(fs.readdirSync(path.join(outputDirectory, "assets")).sort().join("\n"))
        .update(fs.readFileSync(path.join(outputDirectory, "manifest.json")))
        .update(worker);
      for (const asset of [
        "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png",
        "brand/privatools-icon-96.png", "brand/privatools-favicon.svg", "brand/privatools-icon-180.png",
        "experience/air-mist.png", "experience/air-graphite.png",
      ]) {
        digest.update(fs.readFileSync(path.join(outputDirectory, asset)));
      }
      const version = `v2.${digest.digest("hex").slice(0, 16)}`;
      if (!worker.includes('const CACHE_VERSION = "v2.0.0";')) {
        throw new Error("Service worker version marker is missing.");
      }
      fs.writeFileSync(workerPath, worker.replace('const CACHE_VERSION = "v2.0.0";', `const CACHE_VERSION = "${version}";`));
      console.log(`[pwa] offline shell ${version}`);
    },
  };
}

export default defineConfig({
  server: {
    host: "::",
    port: Number(process.env.PORT) || 8080,
    strictPort: false,
    hmr: { overlay: false },
    proxy: {
      "/api/": {
        // Override when the backend runs somewhere else, e.g.
        //   VITE_DEV_API_TARGET=http://localhost:8001 npm run dev
        target: process.env.VITE_DEV_API_TARGET || "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
  // rnnoiseWasmPlugin: Voice Noise Remover's RNNoise WebAssembly, emitted as an asset of its own (scripts/rnnoise-wasm.mjs).
  plugins: [react(), serviceWorkerVersionPlugin(), rnnoiseWasmPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    modulePreload: {
      resolveDependencies: (_filename, deps) =>
        deps.filter(dep => !/(^|\/)(vendor-icons|tool-catalog)-/.test(dep)),
    },
    rollupOptions: {
      output: {
        // Split large vendor libraries into separate cached chunks so
        // returning users get them from the SW/CDN cache instead of
        // re-downloading on every deploy. Vite 8/Rolldown requires the
        // function form here; the object form Rollup accepted in Vite 5 now
        // fails at build time.
        manualChunks,
      },
    },
    // Target modern browsers for smaller output
    target: "es2020",
    // The expected >600 kB JS chunks are lazy: the @huggingface/transformers
    // runtime for AI PDF tools, and gpt-tokenizer's two rank tables for the
    // AI Token Counter, which this warning names on every build
    // (scripts/check-bundle-size.mjs gives them ceilings of their own). Keep
    // the warning below 1 MB so accidental eager bundles still fail loudly.
    chunkSizeWarningLimit: 900,
  },
  esbuild: {
    // Drop dev-only console calls + debugger statements from the production
    // bundle so accidental `console.log("foo", bigObject)` left in tool UIs
    // doesn't ship to users. `console.error` / `console.warn` are kept so
    // real failures still surface in production telemetry.
    drop: ["debugger"],
    pure: ["console.log", "console.debug", "console.trace"],
  },
});
