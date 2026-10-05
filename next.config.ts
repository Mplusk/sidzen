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
    const catalogOnlySections = ["technologies", "blog", "compare", "search"];
    return [
      { source: "/", destination: "/catalog/", permanent: true },
      ...catalogOnlySections.map((section) => ({ source: `/${section}/:path*`, destination: "/catalog/", permanent: true })),
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
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'; object-src 'none'; base-uri 'self'" }
        ]
      },
      {
        source: "/:section(account|admin|checkout|cart|login|register|api/account|api/auth)/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store, max-age=0" }, { key: "X-Robots-Tag", value: "noindex, nofollow" }]
      }
    ];
  }
};

export default nextConfig;
