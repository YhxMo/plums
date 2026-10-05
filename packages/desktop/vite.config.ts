import { defineConfig } from "vite";
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist/renderer",
    emptyOutDir: false,
    rollupOptions: {
      input: { manager: "index.html", confirm: "confirm.html" },
    },
  },
});
