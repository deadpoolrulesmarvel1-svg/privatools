import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { rnnoiseWasmPlugin } from "./scripts/rnnoise-wasm.mjs";

export default defineConfig({
  plugins: [react(), rnnoiseWasmPlugin()],
  test: {
    environment: "jsdom",
    // Existing native-account tests explicitly exercise the supported legacy deployment.
    env: { VITE_AUTH_PROVIDER: "local", VITE_CLERK_PUBLISHABLE_KEY: "" },
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
