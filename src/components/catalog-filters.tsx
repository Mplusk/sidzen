"use client";
import Link from "next/link";
import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CatalogParams } from "@/lib/catalog";
import { filterValues } from "@/lib/catalog-search";
type Option = { slug: string; name: string; count: number };
export function CatalogFilters({ base, params, categories, groups, count }: { base: string; params: CatalogParams; categories: Option[]; groups: Array<{ key: "material" | "technology" | "color"; label: string; options: Option[] }>; count: number }) {
  const router = useRouter(), [pending, startTransition] = useTransition();
  const dialog = useRef<HTMLDialogElement>(null), form = useRef<HTMLFormElement>(null);
  function apply() {
    const data = new FormData(form.current!), query = new URLSearchParams();
    for (const key of ["material", "technology", "color"]) { const values = data.getAll(key).map(String); if (values.length) query.set(key, values.join(",")); }
    for (const key of ["min", "max", "q", "sort", "availability"]) { const value = String(data.get(key) ?? "").trim(); if (value && value !== "popular") query.set(key, value); }
    startTransition(() => router.push(base + (query.size ? "?" + query : ""), { scroll: false }));
  }
  const active = Object.keys(params).some((key) => !["sort", "page", "category"].includes(key) && params[key as keyof CatalogParams]);
  return <form ref={form} className={"catalog-controls" + (pending ? " is-pending" : "")} onSubmit={(event) => { event.preventDefault(); apply(); }}>
    <input type="hidden" name="q" value={params.q ?? ""} />
    <nav className="catalog-category-strip" aria-label="Категории товаров"><Link href="/catalog/" aria-current={base === "/catalog/" ? "page" : undefined}>Все товары</Link>{categories.filter((item) => item.count > 0 || base === `/catalog/${item.slug}/`).map((item) => <Link key={item.slug} href={`/catalog/${item.slug}/`} aria-current={base === `/catalog/${item.slug}/` ? "page" : undefined}>{item.name}</Link>)}</nav>
    <div className="catalog-search"><button className="button button--ghost mobile-filter-toggle" type="button" onClick={() => dialog.current?.showModal()}>Фильтры{active ? " · выбраны" : ""}</button><select key={params.sort ?? ""} name="sort" defaultValue={params.sort ?? "popular"} aria-label="Сортировка" onChange={apply}><option value="popular">Сначала в наличии</option><option value="new">Сначала новые</option><option value="price-asc">Дешевле</option><option value="price-desc">Дороже</option></select></div>
    <dialog ref={dialog} className="filter-dialog" aria-label="Фильтры каталога" onClick={(event) => { if (event.target === dialog.current) dialog.current.close(); }}>
      <div className="filter-dialog__content"><div className="filter-dialog__heading"><h2>Фильтры</h2><button type="button" className="button button--ghost button--small" onClick={() => dialog.current?.close()} aria-label="Закрыть фильтры">✕</button></div>
        <fieldset className="filter-group"><legend>Категория</legend><Link className="filter-option" href="/catalog/" onClick={() => dialog.current?.close()}>Все категории</Link>{categories.map((item) => <Link className="filter-option" href={"/catalog/" + item.slug + "/"} key={item.slug} onClick={() => dialog.current?.close()}>{item.name}<small>{item.count}</small></Link>)}</fieldset>
        {groups.map((group) => <fieldset className="filter-group" key={group.key + (params[group.key] ?? "")}><legend>{group.label}</legend>{group.options.map((item) => <label className="filter-option" key={item.slug}><input type="checkbox" name={group.key} value={item.slug} defaultChecked={filterValues(params[group.key]).includes(item.slug)} onChange={apply} />{item.name}<small>{item.count}</small></label>)}</fieldset>)}
        <fieldset className="filter-group"><legend>Базовая цена, ₽</legend><div className="price-inputs"><input key={"min" + params.min} name="min" type="number" min="0" aria-label="Цена от" placeholder="От" defaultValue={params.min} onBlur={apply} /><input key={"max" + params.max} name="max" type="number" min="0" aria-label="Цена до" placeholder="До" defaultValue={params.max} onBlur={apply} /></div></fieldset>
        <label className="filter-option"><input key={params.availability ?? ""} type="checkbox" name="availability" value="stock" defaultChecked={params.availability === "stock"} onChange={apply} />В наличии</label>
        {active && <Link className="text-link" href={base} onClick={() => dialog.current?.close()}>Сбросить фильтры</Link>}
        <button type="button" className="button filter-done" aria-busy={pending} onClick={() => dialog.current?.close()}>{pending ? "Обновляем товары…" : `Готово · найдено ${count}`}</button>
      </div>
    </dialog>
    <span className="visually-hidden" role="status">{pending ? "Обновляем товары" : "Найдено: " + count}</span>
  </form>;
}
