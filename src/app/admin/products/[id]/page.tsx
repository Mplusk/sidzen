import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminProductForm, type ProductFormOptions, type ProductFormValue } from "@/components/admin-product-form";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/permissions";
import { saveProductGroup } from "@/app/actions/product-groups";
import { getCategoryAiConfig, categoryAiReady } from "@/lib/category-ai/config";
import { categoryAiJobMessages, categoryAiErrorMessages } from "@/lib/category-ai/worker";
import { ConfirmAction } from "@/components/confirm-action";
import { deleteProductAction } from "@/app/actions/product-delete";

export const metadata: Metadata = { title: "Редактирование товара", robots: { index: false, follow: false } };

export default async function AdminProductPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; created?: string; error?: string; groupError?: string }> }) {
  const user = await requirePermission(PERMISSIONS.productsWrite);
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const [product, categories, materials, colors, technologies, qualityProfiles, postProcesses] = await Promise.all([
    prisma.product.findUnique({ where: { id }, include: { categories: { orderBy: { isPrimary: "desc" }, include: { category: { select: { slug: true } } } }, images: { orderBy: { sortOrder: "asc" } }, materials: { select: { id: true } }, colors: { select: { id: true } }, technologies: { select: { id: true } }, qualityProfiles: { select: { id: true } }, postProcesses: { select: { id: true } } } }),
    prisma.category.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.material.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.color.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, hex: true } }),
    prisma.technology.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.qualityProfile.findMany({ orderBy: { layerHeightMm: "desc" }, select: { id: true, name: true, layerHeightMm: true } }),
    prisma.postProcessOption.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, price: true } }),
  ]);
  if (!product || (product.type !== "READY" && product.type !== "PARAMETRIC")) notFound();
  if (product.status === "PUBLISHED") await requirePermission(PERMISSIONS.productsPublish);

  const options: ProductFormOptions = {
    categories,
    materials,
    colors,
    technologies,
    qualityProfiles: qualityProfiles.map((item) => ({ ...item, layerHeightMm: Number(item.layerHeightMm) })),
    postProcesses: postProcesses.map((item) => ({ ...item, price: Number(item.price) })),
  };
  const primaryCategory = product.categories.find((item) => item.isPrimary) ?? product.categories[0];
  const value: ProductFormValue = {
    ...product,
    type: product.type,
    basePrice: Number(product.basePrice),
    oldPrice: product.oldPrice == null ? null : Number(product.oldPrice),
    costPrice: product.costPrice == null ? null : Number(product.costPrice),
    weightGrams: product.weightGrams == null ? null : Number(product.weightGrams),
    widthMm: product.widthMm == null ? null : Number(product.widthMm),
    depthMm: product.depthMm == null ? null : Number(product.depthMm),
    heightMm: product.heightMm == null ? null : Number(product.heightMm),
    robots: product.robots as ProductFormValue["robots"],
    primaryCategoryId: primaryCategory?.categoryId ?? "",
    categoryIds: product.categories.map((item) => item.categoryId),
    materialIds: product.materials.map((item) => item.id),
    colorIds: product.colors.map((item) => item.id),
    technologyIds: product.technologies.map((item) => item.id),
    qualityProfileIds: product.qualityProfiles.map((item) => item.id),
    postProcessIds: product.postProcesses.map((item) => item.id),
  };
  const publicHref = primaryCategory && product.status === "PUBLISHED" ? `/catalog/${primaryCategory.category.slug}/${product.slug}/` : null;
  const canGroup = user.permissions.has(PERMISSIONS.productsPublish) || user.roles.includes("superadmin");
  const groups = canGroup ? await prisma.productGroup.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { products: true } } } }) : [];
  const members = product.groupId && canGroup ? await prisma.product.findMany({ where: { groupId: product.groupId }, select: { id: true, sku: true, groupLabel: true, status: true }, orderBy: { sku: "asc" } }) : [];
  const aiReady = categoryAiReady(await getCategoryAiConfig());
  const aiJob = await prisma.productCategoryAiJob.findUnique({ where: { productId: product.id } });
  const aiMessage = aiJob ? aiJob.status === "FAILED" ? categoryAiErrorMessages[aiJob.errorCode ?? ""] ?? "Не удалось определить категорию. Выберите вручную или повторите." : categoryAiJobMessages[aiJob.status] : undefined;

  return <><div className="admin-header"><div><span className="eyebrow">{product.sku}</span><h1>{product.name}</h1></div><div className="admin-header__actions"><Link className="button button--outline" href="/admin/products/">К списку</Link>{publicHref && <Link className="button button--outline" href={publicHref} target="_blank">Открыть на сайте</Link>}</div></div>{(query.saved || query.created) && <p className="notice notice--success">Изменения сохранены.</p>}<AdminProductForm options={options} product={value} error={query.error} canPublish={canGroup} aiReady={aiReady} aiMessage={product.categoryMode === "AI" && !aiReady ? "Категоризация приостановлена: DeepSeek выключен в подключениях магазина." : aiMessage} />
    {canGroup && <section className="content-card" id="product-group"><h2>Группа карточек — цвета и варианты</h2>
      <p>Варианты показываются фотографиями в карточке товара. У каждого остаются свои артикул, цена, остаток, отзывы и фотографии. Покупатель видит только опубликованные варианты с доступной категорией.</p>
      <p className="muted">{product.groupingMode === "AUTO" ? "Группировка из WB обновляется при синхронизации." : "Ручная группировка защищена от синхронизации."}</p>
      {query.groupError && <p role="alert" className="notice notice--error">Не удалось сохранить группу. Дождитесь завершения синхронизации и проверьте выбранную группу.</p>}
      <form action={saveProductGroup} className="form-grid">
        <input type="hidden" name="productId" value={product.id} />
        <label className="field">Группа<select name="groupId" defaultValue={product.groupId ?? ""}><option value="">Без группы — исключить карточку</option>{groups.map(group => <option key={group.id} value={group.id}>{group.name} · {group._count.products} шт. · {group.id.slice(-6)}</option>)}</select></label>
        <label className="field">Или создать новую группу<input name="newName" maxLength={180} placeholder="Например, Чаша Коралл" /></label>
        <label className="field">Подпись варианта<input name="label" maxLength={180} defaultValue={product.groupLabel ?? product.sku} placeholder="Например, Зелёный" /></label>
        <label className="field">Управление группой<select name="mode" defaultValue="MANUAL"><option value="MANUAL">Сохранить вручную — не менять при импорте</option><option value="AUTO">Восстановить группировку WB при следующем импорте</option></select></label>
        <button className="button">Сохранить группу карточки</button>
      </form>
      {members.length > 0 && <p>Карточки группы: {members.map(member => <Link key={member.id} className="text-link" style={{ marginRight: 12 }} href={`/admin/products/${member.id}/#product-group`}>{member.sku} · {member.groupLabel || member.sku} · {member.status}</Link>)}</p>}
    </section>}
    <section className="content-card" id="delete-product"><h2>Удаление товара</h2>
      <p>Карточка, варианты, отзывы с фото, избранное и позиции в корзинах будут удалены. Старые заказы сохранят название, артикул и стоимость. На WB и Ozon товар останется: при следующей синхронизации он добавится на сайт заново как новый товар, без прежних отзывов.</p>
      <ConfirmAction title={`Удалить «${product.name}» полностью?`} description={`Артикул: ${product.sku}. Карточка и отзывы будут удалены. История заказов и другие товары группы останутся. Следующая синхронизация может добавить товар заново, но не восстановит отзывы.`} trigger="Удалить товар полностью" confirmLabel="Да, удалить товар" action={deleteProductAction}>
        <input type="hidden" name="id" value={product.id} /><input type="hidden" name="confirmation" value={product.id} />
      </ConfirmAction>
    </section>
  </>;
}
