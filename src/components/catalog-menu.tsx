"use client";

import Link from "next/link";
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
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
  const menu = useRef<HTMLDivElement>(null);
  const scrollBeforeToggle = useRef<number | null>(null);
  const updateOffset = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    const header = menu.current?.closest<HTMLElement>(".site-header");
    if (!header) return;
    const style = document.documentElement.style;
    const previous = style.getPropertyValue("--header-offset");
    const sync = () => style.setProperty("--header-offset", `${Math.ceil(header.getBoundingClientRect().height) + 16}px`);
    updateOffset.current = sync;
    sync();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(sync) : null;
    observer?.observe(header);
    window.addEventListener("resize", sync);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", sync);
      updateOffset.current = () => {};
      if (previous) style.setProperty("--header-offset", previous);
      else style.removeProperty("--header-offset");
    };
  }, []);
  useLayoutEffect(() => {
    updateOffset.current();
    // Force layout before restoring the original scroll coordinate. Browser
    // scroll anchoring must not cancel the space added by the expanded row.
    if (scrollBeforeToggle.current !== null) {
      window.scrollTo({ top: scrollBeforeToggle.current, behavior: "instant" });
      scrollBeforeToggle.current = null;
    }
  }, [open]);
  return <div ref={menu} className="container header-catalog-menu" data-open={open}>
    <div className="header-main">
      {logo}
      <button type="button" className="header-catalog" aria-label="Каталог" aria-expanded={open} aria-controls={id}
        onPointerDown={() => { scrollBeforeToggle.current = window.scrollY; }}
        onPointerCancel={() => { scrollBeforeToggle.current = null; }}
        onPointerLeave={() => { scrollBeforeToggle.current = null; }}
        onKeyDown={event => { if (event.key === "Enter" || event.key === " ") scrollBeforeToggle.current = window.scrollY; }}
        onClick={() => { scrollBeforeToggle.current ??= window.scrollY; setOpen(value => !value); }}><CatalogIcon aria-hidden="true" /><span>Каталог</span></button>
      {search}
      {actions}
    </div>
    <nav id={id} className="header-catalog-panel" hidden={!open} aria-label="Категории товаров">
      <Link href="/" aria-current={pathname === "/" || pathname === "/catalog/" ? "page" : undefined}>Все товары</Link>
      {categories.map(category => <Link key={category.slug} href={`/catalog/${category.slug}/`} aria-current={pathname === `/catalog/${category.slug}/` ? "page" : undefined}>{category.name}</Link>)}
    </nav>
  </div>;
}
