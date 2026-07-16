import type { MetadataRoute } from "next"

// Manifest do PWA — permite "Adicionar à Tela de Início" no iPhone com o
// logo e nome ROI-NADOS. Requisito da Apple para Web Push no iOS (16.4+).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ROI-NADOS",
    short_name: "ROI-NADOS",
    description: "Painel de vendas, tracking e TikTok Ads",
    // O Next roda com basePath /dashboard — assets ficam sob esse prefixo.
    start_url: "/dashboard",
    scope: "/dashboard",
    display: "standalone",
    background_color: "#08080a",
    theme_color: "#08080a",
    icons: [
      { src: "/dashboard/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/dashboard/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/dashboard/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  }
}
