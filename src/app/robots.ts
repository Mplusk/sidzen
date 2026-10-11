import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots { return { rules: [{ userAgent: "*", allow: ["/"], disallow: ["/admin/", "/account/", "/cart/", "/checkout/", "/login/", "/register/", "/forgot-password/", "/legal/", "/api/"] }], sitemap: "https://sidzen.shop/sitemap.xml", host: "https://sidzen.shop" }; }
