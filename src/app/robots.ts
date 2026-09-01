import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots { return { rules: [{ userAgent: "*", allow: ["/", "/catalog/", "/materials/", "/technologies/", "/blog/", "/faq/", "/delivery/", "/about/", "/contacts/"], disallow: ["/admin/", "/account/", "/cart/", "/checkout/", "/search/", "/api/", "/*?sort=", "/*?color="] }], sitemap: "https://3dprinta.shop/sitemap.xml", host: "https://3dprinta.shop" }; }
