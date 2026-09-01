import Link from "next/link";
import { ProductCard } from "@/components/product-card";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { getCatalog, type CatalogParams } from "@/lib/catalog";

export async function CatalogView({ category, searchParams }: { category?: { slug: string; name: string; description?: string | null; h1?: string | null }; searchParams: CatalogParams }) {
  const data = await getCatalog({ ...searchParams, category: category?.slug });
  const makeUrl = (patch: Record<string, string | undefined>) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...searchParams, ...patch })) if (value) query.set(key, value);
    const base = category ? `/catalog/${category.slug}/` : "/catalog/";
    return `${base}${query.size ? `?${query}` : ""}`;
  };
  return (
    <>
      <div className="container"><Breadcrumbs items={[{ label: "Каталог" }, ...(category ? [{ label: category.name }] : [])]} /></div>
      <header className="page-hero page-hero--compact"><div className="container"><span className="eyebrow">Каталог 3DPRINTA</span><h1>{category?.h1 ?? category?.name ?? "Изделия, напечатанные для дела"}</h1><p>{category?.description ?? "Готовые органайзеры, крепления, декор и прототипы. Выберите материал, цвет и качество печати."}</p></div></header>
      <div className="container catalog-layout">
        <aside className="filters">
          <form action={category ? `/catalog/${category.slug}/` : "/catalog/"}>
            <div className="filter-group"><h3>Категория</h3>{data.categories.map((item) => <Link className="filter-option" href={`/catalog/${item.slug}/`} key={item.id}>{item.name}</Link>)}</div>
            <div className="filter-group"><h3>Материал</h3>{data.materials.map((material) => <label className="filter-option" key={material.id}><input type="radio" name="material" value={material.slug} defaultChecked={searchParams.material === material.slug} />{material.name}</label>)}</div>
            <div className="filter-group"><h3>Технология</h3>{data.technologies.map((technology) => <label className="filter-option" key={technology.id}><input type="radio" name="technology" value={technology.slug} defaultChecked={searchParams.technology === technology.slug} />{technology.name}</label>)}</div>
            <div className="filter-group"><h3>Наличие</h3><label className="filter-option"><input type="checkbox" name="availability" value="stock" defaultChecked={searchParams.availability === "stock"} />В наличии</label></div>
            <div style={{ display: "flex", gap: 8, marginTop: 18 }}><button className="button button--small" type="submit">Применить</button><Link className="button button--small button--ghost" href={category ? `/catalog/${category.slug}/` : "/catalog/"}>Сбросить</Link></div>
          </form>
        </aside>
        <section className="catalog-products">
          <div className="catalog-toolbar"><span>Найдено: <strong>{data.count}</strong></span><form><select name="sort" defaultValue={searchParams.sort ?? "popular"} aria-label="Сортировка"><option value="popular">Сначала популярные</option><option value="new">Сначала новые</option><option value="price-asc">Цена по возрастанию</option><option value="price-desc">Цена по убыванию</option></select><button className="button button--small button--ghost" type="submit">Сортировать</button></form></div>
          {data.products.length ? <div className="product-grid">{data.products.map((product) => <ProductCard key={product.id} product={product} />)}</div> : <div className="empty-state"><h3>По этим условиям товаров пока нет</h3><p>Сбросьте фильтры или отправьте модель на индивидуальную печать.</p><Link className="button" href="/print/">Рассчитать печать</Link></div>}
          {data.pages > 1 && <nav className="pagination" aria-label="Страницы каталога">{Array.from({ length: data.pages }, (_, index) => index + 1).map((page) => page === data.page ? <span className="active" key={page}>{page}</span> : <Link key={page} href={makeUrl({ page: String(page) })}>{page}</Link>)}</nav>}
        </section>
      </div>
      {category?.description && <section className="section section--white"><div className="container rich-text"><h2>О разделе «{category.name}»</h2><p>{category.description}</p><p>Параметры изделий можно менять без появления дублей страниц: конфигурация материала и цвета хранится внутри одной канонической карточки. Для нестандартного размера отправьте запрос через раздел печати по модели.</p></div></section>}
    </>
  );
}
