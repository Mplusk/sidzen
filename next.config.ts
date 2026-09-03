import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  trailingSlash: true,
  poweredByHeader: false,
  turbopack: { root: process.cwd() },
  experimental: {
    serverActions: {
      bodySizeLimit: "110mb",
    },
  },
  async redirects() {
    const catalogOnlySections = ["print", "materials", "technologies", "blog", "faq", "delivery", "about", "contacts", "compare", "search"];
    return [
      { source: "/", destination: "/catalog/", permanent: true },
      ...catalogOnlySections.map((section) => ({ source: `/${section}/:path*`, destination: "/catalog/", permanent: true })),
      { source: "/account/models/:path*", destination: "/account/", permanent: true },
      { source: "/account/favorites/:path*", destination: "/account/", permanent: true },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'; object-src 'none'; base-uri 'self'" }
        ]
      }
    ];
  }
};

export default nextConfig;
