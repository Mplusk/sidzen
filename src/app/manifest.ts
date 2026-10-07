import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return { name: "SIDZEN — 3D декор для дома", short_name: "SIDZEN", lang: "ru", start_url: "/catalog/", display: "standalone", background_color: "#f8f5ef", theme_color: "#6b6f5b", icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }, { src: "/icon-512.png", sizes: "512x512", type: "image/png" }] };
}
