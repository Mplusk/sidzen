import Link from "next/link";
import { JsonLd } from "@/components/json-ld";

export type Breadcrumb = { label: string; href?: string };

export function Breadcrumbs({ items, visible = true }: { items: Breadcrumb[]; visible?: boolean }) {
  const nestedItems = items.filter((item, index) => !(index === 0 && item.label === "Каталог"));
  return (
    <><JsonLd data={{ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [{ label: "Каталог", href: "/catalog/" }, ...nestedItems].map((item, index) => ({ "@type": "ListItem", position: index + 1, name: item.label, ...(item.href ? { item: new URL(item.href, "https://sidzen.shop").href } : {}) })) }} />{visible && <nav className="breadcrumbs" aria-label="Хлебные крошки">
      <Link href="/">Каталог</Link>
      {nestedItems.map((item) => <span key={`${item.href}-${item.label}`}>{item.href ? <Link href={item.href}>{item.label}</Link> : item.label}</span>)}
    </nav>}</>
  );
}
