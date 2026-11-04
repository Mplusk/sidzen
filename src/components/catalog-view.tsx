import Link from "next/link";
import { ProductCard } from "@/components/product-card";
import { CatalogFilters } from "@/components/catalog-filters";
import { JsonLd } from "@/components/json-ld";
import { getCatalog, normalizeCatalogParams, type CatalogParams } from "@/lib/catalog";
import { filterValues } from "@/lib/catalog-search";
import { pluralRu } from "@/lib/format";
export async function CatalogView({ category, searchParams }: { category?: { slug: string; name: string; description?: string | null; h1?: string | null }; searchParams: CatalogParams }) {
  const params = normalizeCatalogParams(searchParams);
  const data = await getCatalog({ ...params, category: category?.slug });
  const base = category ? `/catalog/${category.slug}/` : "/";
  const makeUrl = (patch: Record<string, string | undefined>) => { const query = new URLSearchParams(); for (const [key, value] of Object.entries({ ...params, ...patch })) if (value) query.set(key, value); return base + (query.size ? "?" + query : ""); };
  const groups = ([ ["material", "Материал", data.materials], ["color", "Цвет", data.colors] ] as const).map(([key, label, options]) => ({ key, label, options: options.map((item) => ({ slug: item.slug, name: item.name, count: item._count.products })) }));
  const chips = groups.flatMap((group) => filterValues(params[group.key]).map((slug) => ({ label: group.options.find((option) => option.slug === slug)?.name ?? slug, href: makeUrl({ [group.key]: filterValues(params[group.key]).filter((value) => value !== slug).join(","), page: undefined }) })));
  for (const [key, label] of [["q", "Поиск"], ["min", "Цена от"], ["max", "Цена до"], ["availability", "Наличие"]] as const) if (params[key]) chips.push({ label: label + ": " + (key === "availability" ? "в наличии" : params[key]), href: makeUrl({ [key]: undefined, page: undefined }) });
  return <>
    <JsonLd data={{ "@context": "https://schema.org", "@type": "ItemList", numberOfItems: data.count, itemListElement: data.products.map((product, index) => ({ "@type": "ListItem", position: (data.page - 1) * data.pageSize + index + 1, name: product.name, url: `https://sidzen.shop/catalog/${(product.categories.find((item) => item.isPrimary) ?? product.categories[0])?.category.slug ?? "products"}/${product.slug}/` })) }} />
    <h1 className="visually-hidden">{category?.h1 ?? category?.name ?? "Каталог изделий"}</h1>
    <div className="container catalog-shell">
      <CatalogFilters base={base} params={params} groups={groups} count={data.count} />
      <section className="catalog-results" aria-label="Товары">
        <div className="catalog-result-heading"><span>{category?.name ?? "Все товары"}</span><small>{data.count} {pluralRu(data.count, ["товар", "товара", "товаров"])}</small></div>
        {chips.length > 0 && <nav className="filter-chips" aria-label="Выбранные фильтры">{chips.map((chip) => <Link key={chip.label} href={chip.href} scroll={false} aria-label={"Убрать фильтр " + chip.label}>{chip.label} ×</Link>)}<Link href={base}>Сбросить всё</Link></nav>}
        {data.products.length ? <div className="product-grid">{data.products.map((product, index) => <ProductCard key={product.id} product={product} highPriority={index < 2} />)}</div> : <><div className="empty-state"><h2>По этим условиям товаров пока нет</h2><p>Попробуйте другое название или назначение изделия. Например: «подставка», «органайзер», «крепление».</p><Link className="button" href={base}>Сбросить фильтры</Link></div>{data.related.length > 0 && <><h2>Другие товары из каталога</h2><div className="product-grid">{data.related.map((product) => <ProductCard key={product.id} product={product} />)}</div></>}</>}
        {data.pages > 1 && <nav className="pagination" aria-label="Страницы каталога">{Array.from({ length: data.pages }, (_, index) => index + 1).filter((page) => page === 1 || page === data.pages || Math.abs(page - data.page) < 3).map((page) => page === data.page ? <span className="active" aria-current="page" key={page}>{page}</span> : <Link key={page} href={makeUrl({ page: String(page) })}>{page}</Link>)}</nav>}
      </section>
    </div>
  </>;
}
