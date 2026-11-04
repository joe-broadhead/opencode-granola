import { defineConfig } from "vitest/config"

export default defineConfig({
  test: { include: ["test/*.test.ts", "test/tui/*.test.ts"], setupFiles: ["test/setup.ts"] },
})
