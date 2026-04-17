import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

function swBuildHashPlugin(): Plugin {
  return {
    name: "sw-build-hash",
    apply: "build",
    closeBundle() {
      const swPath = path.resolve(import.meta.dirname, "dist/public/sw.js");
      if (fs.existsSync(swPath)) {
        const content = fs.readFileSync(swPath, "utf-8");
        const hash = Date.now().toString(36);
        fs.writeFileSync(swPath, content.replace(/__BUILD_HASH__/g, hash));
      }
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    runtimeErrorOverlay(),
    swBuildHashPlugin(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer(),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("mapbox-gl")) return "vendor-mapbox";
            if (id.includes("react-day-picker") || id.includes("date-fns")) return "vendor-datepicker";
            if (id.includes("@dnd-kit")) return "vendor-dnd";
            if (id.includes("@radix-ui")) return "vendor-radix";
            if (id.includes("recharts") || id.includes("d3-")) return "vendor-charts";
            if (id.includes("react-hook-form") || id.includes("@hookform") || id.includes("zod")) return "vendor-forms";
            if (id.includes("react-dom") || id.includes("/react/") || id.includes("scheduler")) return "vendor-react";
            if (id.includes("@tanstack")) return "vendor-tanstack";
            if (id.includes("wouter")) return "vendor-wouter";
            return "vendor";
          }
        },
      },
    },
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
