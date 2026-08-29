import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  oxc: { jsx: { runtime: "automatic", importSource: "react" } },
  resolve: { alias: { "@": new URL(".", import.meta.url).pathname } },
  test: { exclude: [...configDefaults.exclude, "tests/e2e/**"] },
});
