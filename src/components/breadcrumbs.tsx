import Link from "next/link";

export type Breadcrumb = { label: string; href?: string };

export function Breadcrumbs({ items }: { items: Breadcrumb[] }) {
  return (
    <nav className="breadcrumbs" aria-label="Хлебные крошки">
      <Link href="/">Главная</Link>
      {items.map((item) => <span key={`${item.href}-${item.label}`}>{item.href ? <Link href={item.href}>{item.label}</Link> : item.label}</span>)}
    </nav>
  );
}
