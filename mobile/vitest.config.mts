import { defineConfig } from "vitest/config";

// Component tests (E3) render through react-native-web in jsdom. Pure-logic
// tests are unaffected: the alias only matters to files that import RN.
export default defineConfig({
  resolve: { alias: { "react-native": "react-native-web" } },
  define: { __DEV__: "false" },
  test: { setupFiles: ["tests/components/setup.ts"] },
});
