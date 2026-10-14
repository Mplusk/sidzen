"use client";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SearchIcon } from "./icons";
import { formatPrice } from "@/lib/format";
type Suggestion = { id: string; name: string; price: number; image: string | null; href: string };
export function CatalogSearchInput() {
  const id = useId(), router = useRouter();
  const [query, setQuery] = useState(""), [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [failed, setFailed] = useState(false), [active, setActive] = useState(-1);
  const cache = useRef(new Map<string, Suggestion[]>()), list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const value = query.trim();
    if (value.length < 2) return;
    const controller = new AbortController();
    let alive = true;
    const timeout = setTimeout(() => controller.abort(), 6000);
    const timer = setTimeout(async () => {
      try {
        let products = cache.current.get(value);
        if (!products) {
          const response = await fetch(`/api/catalog/suggestions/?q=${encodeURIComponent(value)}`, { signal: controller.signal });
          if (!response.ok) throw new Error("unavailable");
          products = (await response.json()).products;
          if (controller.signal.aborted) return;
          if (cache.current.size >= 20) cache.current.delete(cache.current.keys().next().value!);
          cache.current.set(value, products!);
        }
        if (!controller.signal.aborted) { setItems(products!); setBusy(false); }
      } catch { if (alive) { setBusy(false); setFailed(true); } }
      finally { clearTimeout(timeout); }
    }, cache.current.has(value) ? 0 : 250);
    return () => { alive = false; clearTimeout(timer); clearTimeout(timeout); controller.abort(); };
  }, [query]);
  const expanded = open && query.trim().length >= 2;
  const all = `/catalog/?q=${encodeURIComponent(query.trim())}`;
  return <form className="header-search" action="/catalog/" method="get" role="search" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }} onSubmit={event => {
    setOpen(false);
    if (expanded && active >= 0 && items[active]) { event.preventDefault(); router.push(items[active].href); }
  }}>
    <label className="visually-hidden" htmlFor="shop-search">Поиск товаров</label>
    <input id="shop-search" name="q" type="search" role="combobox" aria-autocomplete="list" aria-expanded={expanded} aria-controls={expanded ? id : undefined} aria-activedescendant={expanded && active >= 0 ? `${id}-${active}` : undefined} aria-describedby={`${id}-status`} autoComplete="off" placeholder="Найти предмет для дома" maxLength={120} value={query} onFocus={() => setOpen(true)} onChange={event => { setQuery(event.target.value); setItems([]); setActive(-1); setFailed(false); setOpen(true); setBusy(event.target.value.trim().length >= 2); }} onKeyDown={event => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === "Escape") { event.preventDefault(); setOpen(false); setActive(-1); }
      if ((event.key === "ArrowDown" || event.key === "ArrowUp") && items.length) { event.preventDefault(); setOpen(true); const next = event.key === "ArrowDown" ? (active + 1) % items.length : (active <= 0 ? items.length - 1 : active - 1); setActive(next); list.current?.children[next]?.scrollIntoView({ block: "nearest" }); }
      if (event.key === "Tab") setOpen(false);
    }} />
    <button type="submit" aria-label="Найти товары"><SearchIcon aria-hidden="true" /></button>
    <span className="visually-hidden" id={`${id}-status`} role="status">{expanded ? busy ? "Ищем товары…" : failed ? "Подсказки недоступны. Нажмите Enter для поиска." : `Найдено подсказок: ${items.length}. Стрелки — выбор, Enter — открыть товар.` : ""}</span>
    {expanded && <div className="catalog-suggestions"><div id={id} ref={list} role="listbox" aria-label="Подсказки товаров" aria-busy={busy}>
      {!busy && items.map((item, index) => <Link id={`${id}-${index}`} role="option" aria-selected={active === index} tabIndex={-1} key={item.id} href={item.href} className="catalog-suggestion" onPointerDown={event => event.preventDefault()} onClick={() => setOpen(false)}>
        {item.image && <Image src={item.image} alt="" width={44} height={56} sizes="44px" />}<span>{item.name}<strong>{formatPrice(item.price)}</strong></span>
      </Link>)}
    </div><p>{busy ? "Ищем товары…" : failed ? "Подсказки сейчас недоступны. Поиск по Enter работает." : !items.length ? "Ничего не нашли. Попробуйте другое название или артикул." : ""}</p><Link className="catalog-suggestions-all" href={all} onClick={() => setOpen(false)}>Все результаты поиска →</Link></div>}
  </form>;
}
