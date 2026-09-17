import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return { name: "3DPRINTA — каталог изделий", short_name: "3DPRINTA", lang: "ru", start_url: "/catalog/", display: "standalone", background_color: "#f2f4f7", theme_color: "#132540", icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }, { src: "/icon-512.png", sizes: "512x512", type: "image/png" }] };
}
