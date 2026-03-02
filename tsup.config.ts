import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts", "src/tui.ts"],
  format: ["esm"],
  target: "node22",
  clean: true,
  dts: false,
  splitting: true,
  banner: {
    js: "#!/usr/bin/env node",
  },
});
