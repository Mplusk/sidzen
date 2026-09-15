import type { Metadata } from "next";
import Link from "next/link";
import { createCatalogOptionAction } from "@/app/actions/admin-catalog";
import { DeleteCatalogOption } from "@/components/admin-delete-catalog-option";
import { requirePermission } from "@/lib/auth";
import { catalogOptionInUse, type CatalogKind } from "@/lib/catalog-admin";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Каталог и параметры печати", robots: { index: false, follow: false } };

type CatalogRow = { id: string; name: string; slug: string; detail: React.ReactNode; used: boolean; links: number };

function CatalogCreateForm({ kind, categories }: { kind: CatalogKind; categories: Array<{ id: string; name: string }> }) {
  return <form action={createCatalogOptionAction} className="form-grid catalog-create-form">
    <input type="hidden" name="kind" value={kind} />
    <label className="field"><span>Название *</span><input name="name" minLength={2} maxLength={180} required /></label>
    <label className="field"><span>Slug</span><input name="slug" maxLength={200} placeholder="создастся из названия" /></label>

    {kind === "category" && <label className="field"><span>Родительская категория</span><select name="parentId" defaultValue=""><option value="">Без родителя</option>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label>}
    {kind === "material" && <>
      <label className="field"><span>Тип *</span><input name="type" defaultValue="пластик" maxLength={80} required /></label>
      <label className="field"><span>Плотность, г/см³ *</span><input name="density" type="number" min="0.001" max="100" step="0.0001" required /></label>
      <label className="field"><span>Цена за грамм, ₽ *</span><input name="pricePerGram" type="number" min="0" max="999999" step="0.01" required /></label>
    </>}
    {kind === "color" && <label className="field"><span>Цвет *</span><input name="hex" type="color" defaultValue="#315ee7" required /></label>}
    {kind === "technology" && <>
      <label className="field"><span>Точность</span><input name="accuracy" maxLength={180} placeholder="от ±0,2 мм" /></label>
      <label className="field field--full"><span>Применение</span><input name="applications" maxLength={2_000} /></label>
    </>}
    {kind === "quality" && <>
      <label className="field"><span>Высота слоя, мм *</span><input name="layerHeightMm" type="number" min="0.001" max="10" step="0.001" defaultValue="0.2" required /></label>
      <label className="field"><span>Коэффициент времени *</span><input name="speedMultiplier" type="number" min="0.001" max="100" step="0.001" defaultValue="1" required /></label>
      <label className="field"><span>Коэффициент цены *</span><input name="priceMultiplier" type="number" min="0.001" max="100" step="0.001" defaultValue="1" required /></label>
    </>}
    {kind === "postProcess" && <>
      <label className="field"><span>Цена, ₽ *</span><input name="price" type="number" min="0" max="999999" step="0.01" defaultValue="0" required /></label>
      <label className="field"><span>Дополнительные дни *</span><input name="leadDays" type="number" min="0" max="3650" step="1" defaultValue="0" required /></label>
    </>}
    {kind !== "color" && <label className="field field--full"><span>Описание</span><textarea name="description" maxLength={5_000} /></label>}
    <button className="button" type="submit">Создать</button>
  </form>;
}

function CatalogSection({ kind, title, rows, canWrite, categories }: { kind: CatalogKind; title: string; rows: CatalogRow[]; canWrite: boolean; categories: Array<{ id: string; name: string }> }) {
  return <section className="admin-card admin-card--wide" id={kind}>
    <div className="catalog-section-heading"><h2>{title}</h2><span>{rows.length} записей</span></div>
    {rows.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Название</th><th>Параметры</th><th>Использование</th>{canWrite && <th>Действие</th>}</tr></thead><tbody>{rows.map((row) => <tr key={row.id}>
      <td><strong>{row.name}</strong><br /><small>/{row.slug}/</small></td>
      <td>{row.detail}</td>
      <td>{row.used ? `${row.links} связей` : "Не используется"}</td>
      {canWrite && <td><DeleteCatalogOption kind={kind} id={row.id} name={row.name} used={row.used} /></td>}
    </tr>)}</tbody></table></div> : <p className="catalog-empty">Пока нет записей. Создайте первую ниже.</p>}
    {canWrite && <CatalogCreateForm kind={kind} categories={categories} />}
  </section>;
}

export default async function AdminCatalogPage({ searchParams }: { searchParams: Promise<{ saved?: string; deleted?: string; error?: string }> }) {
  const user = await requirePermission(PERMISSIONS.productsRead);
  const canWrite = user.permissions.has(PERMISSIONS.productsWrite) || user.roles.includes("superadmin");
  const query = await searchParams;
  const [categories, materials, colors, technologies, qualities, postProcesses] = await Promise.all([
    prisma.category.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { products: true, children: true, seoFilters: true } } } }),
    prisma.material.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { products: true, variants: true, orderItems: true } } } }),
    prisma.color.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { products: true, variants: true, orderItems: true } } } }),
    prisma.technology.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { products: true, orderItems: true } } } }),
    prisma.qualityProfile.findMany({ orderBy: { layerHeightMm: "desc" }, include: { _count: { select: { products: true, variants: true, orderItems: true } } } }),
    prisma.postProcessOption.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { products: true } } } }),
  ]);

  const sections: Array<{ kind: CatalogKind; title: string; rows: CatalogRow[] }> = [
    { kind: "category", title: "Категории", rows: categories.map((item) => ({ id: item.id, name: item.name, slug: item.slug, detail: item.visible ? "Видима" : "Скрыта", used: catalogOptionInUse(item._count), links: Object.values(item._count).reduce((sum, value) => sum + value, 0) })) },
    { kind: "material", title: "Материалы", rows: materials.map((item) => ({ id: item.id, name: item.name, slug: item.slug, detail: `${Number(item.density)} г/см³ · ${Number(item.pricePerGram)} ₽/г`, used: catalogOptionInUse(item._count), links: Object.values(item._count).reduce((sum, value) => sum + value, 0) })) },
    { kind: "color", title: "Цвета", rows: colors.map((item) => ({ id: item.id, name: item.name, slug: item.slug, detail: <span className="option-chip"><span className="color-dot" style={{ "--dot": item.hex } as React.CSSProperties} />{item.hex}</span>, used: catalogOptionInUse(item._count), links: Object.values(item._count).reduce((sum, value) => sum + value, 0) })) },
    { kind: "technology", title: "Технологии", rows: technologies.map((item) => ({ id: item.id, name: item.name, slug: item.slug, detail: item.accuracy ?? "—", used: catalogOptionInUse(item._count), links: Object.values(item._count).reduce((sum, value) => sum + value, 0) })) },
    { kind: "quality", title: "Профили качества", rows: qualities.map((item) => ({ id: item.id, name: item.name, slug: item.slug, detail: `Слой ${Number(item.layerHeightMm)} мм · цена ×${Number(item.priceMultiplier)}`, used: catalogOptionInUse(item._count), links: Object.values(item._count).reduce((sum, value) => sum + value, 0) })) },
    { kind: "postProcess", title: "Постобработка", rows: postProcesses.map((item) => ({ id: item.id, name: item.name, slug: item.slug, detail: `${Number(item.price)} ₽ · +${item.leadDays} дн.`, used: catalogOptionInUse(item._count), links: Object.values(item._count).reduce((sum, value) => sum + value, 0) })) },
  ];
  const errorMessage = query.error === "duplicate" ? "Slug уже занят. Укажите другой." : query.error === "inuse" ? "Нельзя удалить запись, которая используется товарами, вариантами, заказами или дочерними категориями." : query.error === "missing" ? "Запись уже удалена." : query.error === "conflict" ? "Запись изменилась одновременно с вашим действием. Обновите страницу и повторите." : query.error ? "Проверьте поля и попробуйте ещё раз." : null;

  return <>
    <div className="admin-header"><div><span className="eyebrow">Справочники</span><h1>Каталог и производство</h1></div><Link className="button button--outline" href="/admin/products/">К товарам</Link></div>
    <p className="catalog-admin-intro">Здесь создаются варианты для разделов «Категории» и «Материалы, цвета и производство» в карточке товара. Удаление возможно только после снятия всех связей с товарами и заказами.</p>
    {errorMessage && <p className="notice notice--danger">{errorMessage}</p>}
    {(query.saved || query.deleted) && <p className="notice notice--success">{query.saved ? "Новая запись создана." : "Запись удалена."}</p>}
    <nav className="catalog-admin-nav" aria-label="Разделы справочников">{sections.map((section) => <a href={`#${section.kind}`} key={section.kind}>{section.title}</a>)}</nav>
    <div className="admin-grid">{sections.map((section) => <CatalogSection key={section.kind} {...section} canWrite={canWrite} categories={categories.map(({ id, name }) => ({ id, name }))} />)}</div>
  </>;
}
