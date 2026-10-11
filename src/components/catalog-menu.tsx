"use client";

import Link from "next/link";
import { useId, useRef, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { CatalogIcon } from "@/components/icons";

export function CatalogMenu({ categories }: { categories: { slug: string; name: string }[] }) {
  const menu = useRef<HTMLDetailsElement>(null), trigger = useRef<HTMLElement>(null);
  const id = useId(), pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => { menu.current?.removeAttribute("open"); }, [pathname]);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) menu.current?.removeAttribute("open"); };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && menu.current?.open) { menu.current.removeAttribute("open"); trigger.current?.focus(); event.preventDefault(); }
    };
    document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, []);
  return <details className="header-catalog-menu" ref={menu} onToggle={event => setOpen(event.currentTarget.open)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.removeAttribute("open"); }}>
    <summary className="header-catalog" ref={trigger} role="button" aria-expanded={open} aria-controls={id}><CatalogIcon aria-hidden="true" /><span>Каталог</span></summary>
    <nav id={id} className="header-catalog-panel" aria-label="Категории товаров" onClick={(event) => { if ((event.target as HTMLElement).closest("a")) menu.current?.removeAttribute("open"); }}>
      <Link href="/catalog/" aria-current={pathname === "/catalog/" ? "page" : undefined}>Все товары</Link>
      {categories.map(category => <Link key={category.slug} href={`/catalog/${category.slug}/`} aria-current={pathname === `/catalog/${category.slug}/` ? "page" : undefined}>{category.name}</Link>)}
    </nav>
  </details>;
}
