import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The SDK is consumed via `link:../..`, which symlinks its own
  // node_modules into our resolve graph. Without dedupe, Vite ends up
  // bundling two copies of React (one from the SDK's devDeps, one from
  // ours) and React tears down with "Invalid hook call".
  resolve: {
    dedupe: ["react", "react-dom"],
  },
  server: {
    port: 5174,
    strictPort: true,
  },
});
