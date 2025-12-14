import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  base: "/engramma/",
  plugins: [svelte()],
  build: {
    // auto prefixing height: stretch breaks the app
    cssMinify: false,
  },
});
