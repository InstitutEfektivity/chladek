import { defineConfig } from "vite";

// Statický build, nasazení na chladek.institutefektivity.cz (root path).
export default defineConfig({
  base: "/",
  build: {
    target: "es2020",
    outDir: "dist",
    assetsInlineLimit: 4096,
  },
});
