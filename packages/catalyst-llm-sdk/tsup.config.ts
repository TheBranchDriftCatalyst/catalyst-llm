import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "client/index": "src/client/index.ts",
    "agent/index": "src/agent/index.ts",
    "react/index": "src/react/index.ts",
    "components/index": "src/components/index.ts",
    "dev/index": "src/dev/index.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  external: ["react", "react-dom"],
});
