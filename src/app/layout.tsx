import type { Metadata, Viewport } from "next";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { CookieBanner } from "@/components/cookie-banner";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://3dprinta.shop"),
  title: { default: "Каталог изделий 3DPRINTA", template: "%s | 3DPRINTA" },
  description: "Каталог готовых изделий с выбором материала, цвета и доставкой по России.",
  applicationName: "3DPRINTA",
  alternates: { canonical: "/catalog/" },
  openGraph: { type: "website", locale: "ru_RU", siteName: "3DPRINTA", images: [{ url: "/generated/hero-studio.webp", width: 1536, height: 1024 }] },
  icons: { icon: "/favicon.svg" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#132540", colorScheme: "light" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>
        <a className="skip-link" href="#main">К содержимому</a>
        <Header />
        <main id="main">{children}</main>
        <Footer />
        <CookieBanner />
      </body>
    </html>
  );
}
