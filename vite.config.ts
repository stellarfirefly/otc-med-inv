import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const base = process.env.VITE_BASE ?? "/";

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["pwa.svg"],
      manifest: {
        name: "OTC Medication Inventory",
        short_name: "OTC Inventory",
        description: "Local-first OTC medication inventory and expiration tracking.",
        theme_color: "#0f766e",
        background_color: "#f7faf9",
        display: "standalone",
        start_url: ".",
        scope: ".",
        icons: [
          {
            src: "pwa.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable"
          }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        navigateFallback: `${base}index.html`
      }
    })
  ]
});
