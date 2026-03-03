import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["./src/index.ts", "./src/cli.ts"],
  outDir: "dist",
  sourcemap: false,
  clean: true,
  dts: false,
  format: ["cjs"],
  minify: "terser",
  treeshake: true,
});
