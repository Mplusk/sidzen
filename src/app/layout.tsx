import type { Metadata, Viewport } from "next";
import { JsonLd } from "@/components/json-ld";
import { getStoreContacts } from "@/lib/settings";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { CookieBanner } from "@/components/cookie-banner";
import "leaflet/dist/leaflet.css";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://3dprinta.shop"),
  title: { default: "Каталог изделий 3DPRINTA", template: "%s | 3DPRINTA" },
  description: "Каталог готовых изделий с выбором материала, цвета и доставкой по России.",
  applicationName: "3DPRINTA",
  alternates: { canonical: "/catalog/" },
  openGraph: { type: "website", locale: "ru_RU", siteName: "3DPRINTA", images: [{ url: "/generated/hero-studio.webp", width: 1536, height: 1024 }] },
  icons: { icon: [{ url: "/favicon.svg", type: "image/svg+xml" }, { url: "/favicon.ico", sizes: "32x32" }], apple: "/apple-touch-icon.png" },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#f2f4f7", colorScheme: "light" };

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const contacts = await getStoreContacts();
  return (
    <html lang="ru">
      <body>
        <a className="skip-link" href="#main">К содержимому</a>
        <JsonLd data={{ "@context": "https://schema.org", "@type": "Organization", "@id": "https://3dprinta.shop/#organization", name: "3DPRINTA", url: "https://3dprinta.shop", logo: "https://3dprinta.shop/icon-512.png", ...(contacts.legalName ? { legalName: contacts.legalName } : {}), ...(contacts.phone ? { telephone: contacts.phone } : {}), ...(contacts.email ? { email: contacts.email } : {}) }} />
        <Header />
        <main id="main">{children}</main>
        <Footer />
        <CookieBanner />
      </body>
    </html>
  );
}
