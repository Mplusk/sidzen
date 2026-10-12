"use client";

import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { CatalogIcon } from "@/components/icons";

export function CatalogMenu({ categories, logo, search, actions }: {
  categories: { slug: string; name: string }[];
  logo: ReactNode;
  search: ReactNode;
  actions: ReactNode;
}) {
  const id = useId(), pathname = usePathname();
  // The shared header keeps this choice across category navigation. Only the
  // Catalog button changes it; choosing a category or opening filters does not.
  const [open, setOpen] = useState(false);
  return <div className="container header-catalog-menu" data-open={open}>
    <div className="header-main">
      {logo}
      <button type="button" className="header-catalog" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}><CatalogIcon aria-hidden="true" /><span>Каталог</span></button>
      {search}
      {actions}
    </div>
    <nav id={id} className="header-catalog-panel" hidden={!open} aria-label="Категории товаров">
      <Link href="/catalog/" aria-current={pathname === "/catalog/" ? "page" : undefined}>Все товары</Link>
      {categories.map(category => <Link key={category.slug} href={`/catalog/${category.slug}/`} aria-current={pathname === `/catalog/${category.slug}/` ? "page" : undefined}>{category.name}</Link>)}
    </nav>
  </div>;
}
