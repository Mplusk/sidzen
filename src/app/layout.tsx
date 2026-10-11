import type { Metadata, Viewport } from "next";
import { JsonLd } from "@/components/json-ld";
import { getStoreContacts } from "@/lib/settings";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { CookieBanner } from "@/components/cookie-banner";
import { MonitoringTracker } from "@/components/monitoring-tracker";
import { Suspense } from "react";
import "leaflet/dist/leaflet.css";
import "@fontsource-variable/inter/opsz.css";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://sidzen.shop"),
  title: { default: "SIDZEN — 3D декор для дома", template: "%s | SIDZEN" },
  description: "Предметы для дома, вдохновлённые природными формами. Декор, свет и полезные детали интерьера с доставкой по России.",
  applicationName: "SIDZEN",
  alternates: { canonical: "/catalog/" },
  openGraph: { type: "website", locale: "ru_RU", siteName: "SIDZEN", images: [{ url: "/brand/sidzen-social.png", width: 1200, height: 630, alt: "SIDZEN — 3D декор для дома" }] },
  icons: { icon: [{ url: "/favicon.svg", type: "image/svg+xml" }, { url: "/favicon.ico", sizes: "32x32" }], apple: "/apple-touch-icon.png" },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#f8f5ef", colorScheme: "light" };

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const contacts = await getStoreContacts();
  return (
    <html lang="ru">
      <body>
        <a className="skip-link" href="#main">К содержимому</a>
        <JsonLd data={{ "@context": "https://schema.org", "@type": "Organization", "@id": "https://sidzen.shop/#organization", name: "SIDZEN", url: "https://sidzen.shop", logo: "https://sidzen.shop/icon-512.png", ...(contacts.legalName ? { legalName: contacts.legalName } : {}), ...(contacts.phone ? { telephone: contacts.phone } : {}), ...(contacts.email ? { email: contacts.email } : {}) }} />
        <Header />
        <main id="main">{children}</main>
        <Footer />
        <CookieBanner />
        <Suspense fallback={null}><MonitoringTracker /></Suspense>
      </body>
    </html>
  );
}
