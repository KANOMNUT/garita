import { defineConfig } from "vitest/config";

// Separate from vite.config.ts on purpose: tests are pure TS (no React, no DOM),
// so they need none of the Tauri dev-server settings.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
