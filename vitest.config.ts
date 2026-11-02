import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/cli.ts",
        "src/visualize.ts",
        "src/types.ts",
        "src/github/client-interface.ts",
        "src/visualizer/browser-client.ts",
        "src/visualizer/browser-client.js",
      ],
      thresholds: {
        branches: 70,
        functions: 80,
        lines: 75,
        statements: 75,
      },
    },
  },
});
