"use client";

import Link from "next/link";
import { useId, useRef, useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { CatalogIcon } from "@/components/icons";

export function CatalogMenu({ categories, logo, search, actions }: {
  categories: { slug: string; name: string }[];
  logo: ReactNode;
  search: ReactNode;
  actions: ReactNode;
}) {
  const menu = useRef<HTMLElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const id = useId(), pathname = usePathname();
  const [state, setState] = useState({ pathname, open: false });
  const open = state.pathname === pathname && state.open;
  useEffect(() => {
    if (!open) return;
    const close = () => setState(value => ({ ...value, open: false }));
    // Close after the click, not on pointerdown/blur: collapsing this row must not
    // move the Filters button away before the user's click reaches it.
    const outside = (event: MouseEvent) => {
      if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { close(); trigger.current?.focus(); event.preventDefault(); }
    };
    document.addEventListener("click", outside); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("click", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  return <div className="container header-catalog-menu" data-open={open}>
    <div className="header-main">
      {logo}
      <button type="button" className="header-catalog" ref={trigger} aria-expanded={open} aria-controls={id} onClick={() => setState({ pathname, open: !open })}><CatalogIcon aria-hidden="true" /><span>Каталог</span></button>
      {search}
      {actions}
    </div>
    <nav id={id} ref={menu} className="header-catalog-panel" hidden={!open} aria-label="Категории товаров" onClick={(event) => { if ((event.target as HTMLElement).closest("a")) setState(value => ({ ...value, open: false })); }}>
      <Link href="/catalog/" aria-current={pathname === "/catalog/" ? "page" : undefined}>Все товары</Link>
      {categories.map(category => <Link key={category.slug} href={`/catalog/${category.slug}/`} aria-current={pathname === `/catalog/${category.slug}/` ? "page" : undefined}>{category.name}</Link>)}
    </nav>
  </div>;
}
