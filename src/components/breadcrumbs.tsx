import Link from "next/link";

export type Breadcrumb = { label: string; href?: string };

export function Breadcrumbs({ items }: { items: Breadcrumb[] }) {
  const nestedItems = items.filter((item, index) => !(index === 0 && item.label === "Каталог"));
  return (
    <nav className="breadcrumbs" aria-label="Хлебные крошки">
      <Link href="/catalog/">Каталог</Link>
      {nestedItems.map((item) => <span key={`${item.href}-${item.label}`}>{item.href ? <Link href={item.href}>{item.label}</Link> : item.label}</span>)}
    </nav>
  );
}
