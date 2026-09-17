import Link from "next/link";
import { JsonLd } from "@/components/json-ld";

export type Breadcrumb = { label: string; href?: string };

export function Breadcrumbs({ items }: { items: Breadcrumb[] }) {
  const nestedItems = items.filter((item, index) => !(index === 0 && item.label === "Каталог"));
  return (
    <><JsonLd data={{ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [{ label: "Каталог", href: "/catalog/" }, ...nestedItems].map((item, index) => ({ "@type": "ListItem", position: index + 1, name: item.label, ...(item.href ? { item: new URL(item.href, "https://3dprinta.shop").href } : {}) })) }} /><nav className="breadcrumbs" aria-label="Хлебные крошки">
      <Link href="/catalog/">Каталог</Link>
      {nestedItems.map((item) => <span key={`${item.href}-${item.label}`}>{item.href ? <Link href={item.href}>{item.label}</Link> : item.label}</span>)}
    </nav></>
  );
}
