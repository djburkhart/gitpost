export default defineNuxtConfig({
  ssr: false,
  compatibilityDate: "2026-01-01",
  devtools: { enabled: false },
  devServer: {
    host: "0.0.0.0",
    port: 8080,
  },
  nitro: {
    devProxy: {
      "/api": { target: "http://127.0.0.1:8090/api", changeOrigin: true },
    },
  },
  app: {
    head: {
      title: "gitpo.st — post like you commit",
      htmlAttrs: { lang: "en" },
      meta: [
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        {
          name: "description",
          content: "A social log for writing. Every post is a real Git commit.",
        },
        { name: "theme-color", content: "#0b0c0b" },
      ],
      link: [
        { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
        { rel: "preconnect", href: "https://fonts.googleapis.com" },
        { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "" },
        {
          rel: "stylesheet",
          href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:ital,wght@0,400;0,500;1,400&family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;1,400&family=Instrument+Serif:ital@0;1&display=swap",
        },
      ],
    },
  },
  css: ["~/assets/css/main.css"],
  vite: {
    server: {
      host: "0.0.0.0",
      port: 8080,
      strictPort: true,
      allowedHosts: true,
      proxy: {
        "/api": {
          target: "http://127.0.0.1:8090",
          changeOrigin: true,
        },
      },
    },
  },
});
