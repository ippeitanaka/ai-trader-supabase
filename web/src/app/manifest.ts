import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Awaji Samurai AI Trader",
    short_name: "Awaji Samurai",
    description: "AIトレーダーの推奨ペア、EAログ、実トレード結果を確認する運用ダッシュボード",
    start_url: "/",
    display: "standalone",
    background_color: "#050910",
    theme_color: "#050910",
    icons: [
      {
        src: "/icon.png",
        sizes: "1254x1254",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon.png",
        sizes: "1254x1254",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/apple-icon.png",
        sizes: "1254x1254",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}