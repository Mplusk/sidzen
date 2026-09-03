import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots { return { rules: [{ userAgent: "*", allow: ["/catalog/"], disallow: ["/admin/", "/account/", "/cart/", "/checkout/", "/login/", "/register/", "/forgot-password/", "/legal/", "/api/", "/*?sort=", "/*?color="] }], sitemap: "https://3dprinta.shop/sitemap.xml", host: "https://3dprinta.shop" }; }
