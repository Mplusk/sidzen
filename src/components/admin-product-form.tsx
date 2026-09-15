import Image from "next/image";
import Link from "next/link";
import { createProductAction, updateProductAction } from "@/app/actions/admin";
import { PRODUCT_STATUSES, PRODUCT_TYPES, ROBOTS_VALUES, serializeGallery } from "@/lib/product-admin";

type Option = { id: string; name: string };
type ColorOption = Option & { hex: string };

export type ProductFormOptions = {
  categories: Option[];
  materials: Option[];
  colors: ColorOption[];
  technologies: Option[];
  qualityProfiles: Array<Option & { layerHeightMm: number }>;
  postProcesses: Array<Option & { price: number }>;
};

export type ProductFormValue = {
  id: string;
  name: string;
  slug: string;
  sku: string;
  type: (typeof PRODUCT_TYPES)[number];
  status: (typeof PRODUCT_STATUSES)[number];
  badge: string | null;
  shortDescription: string | null;
  description: string | null;
  usage: string | null;
  instructions: string | null;
  specifications: unknown;
  basePrice: number;
  oldPrice: number | null;
  costPrice: number | null;
  stock: number;
  madeToOrder: boolean;
  leadDays: number;
  weightGrams: number | null;
  widthMm: number | null;
  depthMm: number | null;
  heightMm: number | null;
  modelAsset: string | null;
  title: string | null;
  metaDescription: string | null;
  h1: string | null;
  canonical: string | null;
  robots: (typeof ROBOTS_VALUES)[number];
  publishedAt: Date | null;
  categoryIds: string[];
  primaryCategoryId: string;
  materialIds: string[];
  colorIds: string[];
  technologyIds: string[];
  qualityProfileIds: string[];
  postProcessIds: string[];
  images: Array<{ path: string; alt: string; caption?: string | null }>;
};

const statusLabels: Record<(typeof PRODUCT_STATUSES)[number], string> = {
  DRAFT: "Черновик",
  REVIEW: "На модерации",
  PUBLISHED: "Опубликован",
  HIDDEN: "Скрыт",
  ARCHIVED: "Архив",
};

const typeLabels: Record<(typeof PRODUCT_TYPES)[number], string> = {
  READY: "Готовый товар",
  PARAMETRIC: "Товар с параметрами",
  PRINT_TEMPLATE: "Шаблон печати",
};

function checked(selected: string[] | undefined, id: string) {
  return selected?.includes(id) ?? false;
}

function dateTimeValue(value?: Date | null) {
  return value ? value.toISOString().slice(0, 16) : "";
}

function CheckboxGroup({ name, options, selected, renderDetail }: { name: string; options: Option[]; selected?: string[]; renderDetail?: (option: Option) => React.ReactNode }) {
  return <div className="admin-options-grid">{options.map((option) => <label className="admin-check" key={option.id}><input type="checkbox" name={name} value={option.id} defaultChecked={checked(selected, option.id)} /><span><strong>{option.name}</strong>{renderDetail?.(option)}</span></label>)}</div>;
}

export function AdminProductForm({ options, product, error, canPublish = true }: { options: ProductFormOptions; product?: ProductFormValue; error?: string; canPublish?: boolean }) {
  const isEdit = Boolean(product);
  const firstCategory = product?.primaryCategoryId || options.categories[0]?.id || "";
  const imagesText = product ? serializeGallery(product.images) : "";
  const specificationsText = product?.specifications ? JSON.stringify(product.specifications, null, 2) : "";
  const previewImage = product?.images[0];
  const errorMessage = error === "duplicate" ? "Slug или артикул уже используются другим товаром." : error === "images" ? "Проверьте список изображений и формат загружаемых файлов." : error === "specifications" ? "Характеристики должны быть корректным JSON-объектом." : error ? "Проверьте заполнение полей товара." : null;

  return <>
    {errorMessage && <p className="notice notice--danger">{errorMessage}</p>}
    <form action={isEdit ? updateProductAction : createProductAction} className="admin-grid">
      {product && <input type="hidden" name="id" value={product.id} />}

      <section className="admin-card"><h2>Основное</h2><div className="form-grid">
        <label className="field field--full"><span>Название *</span><input name="name" defaultValue={product?.name} minLength={3} maxLength={180} required /></label>
        <label className="field"><span>Slug</span><input name="slug" defaultValue={product?.slug} maxLength={200} placeholder="создастся из названия" /></label>
        <label className="field"><span>Артикул *</span><input name="sku" defaultValue={product?.sku} maxLength={80} required /></label>
        <label className="field"><span>Тип товара</span><select name="type" defaultValue={product?.type ?? "READY"}>{PRODUCT_TYPES.map((type) => <option value={type} key={type}>{typeLabels[type]}</option>)}</select></label>
        <label className="field"><span>Статус</span><select name="status" defaultValue={product?.status ?? "DRAFT"}>{PRODUCT_STATUSES.filter((status) => canPublish || status !== "PUBLISHED").map((status) => <option value={status} key={status}>{statusLabels[status]}</option>)}</select></label>
        <label className="field field--full"><span>Бейдж на карточке</span><input name="badge" defaultValue={product?.badge ?? ""} maxLength={80} placeholder="Хит, Новинка, Под заказ" /></label>
      </div></section>

      <section className="admin-card"><h2>Цена и наличие</h2><div className="form-grid">
        <label className="field"><span>Цена, ₽ *</span><input name="basePrice" type="number" min="0" max="999999999" step="0.01" defaultValue={product?.basePrice ?? 0} required /></label>
        <label className="field"><span>Старая цена, ₽</span><input name="oldPrice" type="number" min="0" step="0.01" defaultValue={product?.oldPrice ?? ""} /></label>
        <label className="field"><span>Себестоимость, ₽</span><input name="costPrice" type="number" min="0" step="0.01" defaultValue={product?.costPrice ?? ""} /></label>
        <label className="field"><span>Остаток, шт.</span><input name="stock" type="number" min="0" step="1" defaultValue={product?.stock ?? 0} required /></label>
        <label className="field"><span>Срок изготовления, дней</span><input name="leadDays" type="number" min="1" max="3650" step="1" defaultValue={product?.leadDays ?? 3} required /></label>
        <label className="admin-check admin-check--standalone"><input name="madeToOrder" type="checkbox" defaultChecked={product?.madeToOrder ?? false} /><span><strong>Изготавливается под заказ</strong><small>Показывать срок вместо обычного наличия</small></span></label>
      </div></section>

      <section className="admin-card admin-card--wide"><h2>Категории</h2><div className="form-grid">
        <label className="field"><span>Основная категория *</span><select name="primaryCategoryId" defaultValue={firstCategory} required>{options.categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label>
        <div className="field field--full"><span>Дополнительные категории</span><CheckboxGroup name="categoryIds" options={options.categories} selected={product?.categoryIds} /></div>
      </div></section>

      <section className="admin-card admin-card--wide"><h2>Описание карточки</h2><div className="form-grid">
        <label className="field field--full"><span>Короткое описание</span><textarea name="shortDescription" maxLength={500} defaultValue={product?.shortDescription ?? ""} /></label>
        <label className="field field--full"><span>Полное описание</span><textarea name="description" maxLength={20_000} defaultValue={product?.description ?? ""} style={{ minHeight: 220 }} /></label>
        <label className="field"><span>Применение</span><textarea name="usage" maxLength={5_000} defaultValue={product?.usage ?? ""} /></label>
        <label className="field"><span>Доставка и уход</span><textarea name="instructions" maxLength={5_000} defaultValue={product?.instructions ?? ""} /></label>
      </div></section>

      <section className="admin-card"><h2>Габариты</h2><div className="form-grid">
        <label className="field"><span>Ширина, мм</span><input name="widthMm" type="number" min="0" step="0.001" defaultValue={product?.widthMm ?? ""} /></label>
        <label className="field"><span>Глубина, мм</span><input name="depthMm" type="number" min="0" step="0.001" defaultValue={product?.depthMm ?? ""} /></label>
        <label className="field"><span>Высота, мм</span><input name="heightMm" type="number" min="0" step="0.001" defaultValue={product?.heightMm ?? ""} /></label>
        <label className="field"><span>Вес, г</span><input name="weightGrams" type="number" min="0" step="0.001" defaultValue={product?.weightGrams ?? ""} /></label>
        <label className="field field--full"><span>Путь к файлу модели</span><input name="modelAsset" defaultValue={product?.modelAsset ?? ""} maxLength={500} placeholder="/private/..." /></label>
      </div></section>

      <section className="admin-card"><h2>Характеристики</h2><label className="field"><span>JSON-объект</span><textarea className="admin-code-field" name="specificationsText" defaultValue={specificationsText} placeholder={'{\n  "Слой": "0,2 мм",\n  "Допуск": "±0,3 мм"\n}'} /><small>Каждая пара «ключ — значение» появится строкой в таблице характеристик.</small></label></section>

      <section className="admin-card admin-card--wide"><h2>Материалы, цвета и производство</h2><div className="admin-relations">
        <div><h3>Материалы</h3><CheckboxGroup name="materialIds" options={options.materials} selected={product?.materialIds} /></div>
        <div><h3>Цвета</h3><CheckboxGroup name="colorIds" options={options.colors} selected={product?.colorIds} renderDetail={(option) => <small className="admin-option-detail"><i className="color-dot" style={{ "--dot": (option as ColorOption).hex } as React.CSSProperties} /></small>} /></div>
        <div><h3>Технологии</h3><CheckboxGroup name="technologyIds" options={options.technologies} selected={product?.technologyIds} /></div>
        <div><h3>Качество печати</h3><CheckboxGroup name="qualityProfileIds" options={options.qualityProfiles} selected={product?.qualityProfileIds} renderDetail={(option) => <small>{(option as ProductFormOptions["qualityProfiles"][number]).layerHeightMm} мм</small>} /></div>
        <div><h3>Постобработка</h3><CheckboxGroup name="postProcessIds" options={options.postProcesses} selected={product?.postProcessIds} renderDetail={(option) => <small>{(option as ProductFormOptions["postProcesses"][number]).price} ₽</small>} /></div>
      </div></section>

      <section className="admin-card admin-card--wide"><h2>Изображения</h2><div className="admin-gallery-editor">
        {previewImage && <div className="admin-image-preview"><Image src={previewImage.path} alt={previewImage.alt} fill sizes="180px" /></div>}
        <div className="form-grid">
          <label className="field field--full"><span>Загрузить новые изображения</span><input type="file" name="newImages" accept="image/jpeg,image/png,image/webp,image/avif" multiple /><small>JPG, PNG, WebP или AVIF, до 10 МБ каждый. Новые файлы добавятся в конец галереи.</small></label>
          <label className="field field--full"><span>Галерея</span><textarea className="admin-code-field" name="imagesText" defaultValue={imagesText} placeholder="/generated/product.webp | Описание изображения | Подпись" /><small>Одно изображение на строку: путь | alt-текст | подпись. Первая строка — главное изображение.</small></label>
        </div>
      </div></section>

      <section className="admin-card admin-card--wide"><h2>SEO и публикация</h2><div className="form-grid">
        <label className="field"><span>Title</span><input name="title" defaultValue={product?.title ?? ""} maxLength={180} /></label>
        <label className="field"><span>H1</span><input name="h1" defaultValue={product?.h1 ?? ""} maxLength={180} /></label>
        <label className="field field--full"><span>Meta description</span><textarea name="metaDescription" defaultValue={product?.metaDescription ?? ""} maxLength={500} /></label>
        <label className="field"><span>Canonical URL</span><input name="canonical" defaultValue={product?.canonical ?? ""} maxLength={500} placeholder="/catalog/category/product/" /></label>
        <label className="field"><span>Robots</span><select name="robots" defaultValue={product?.robots ?? "index,follow"}>{ROBOTS_VALUES.map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
        <label className="field"><span>Дата публикации</span><input name="publishedAt" type="datetime-local" defaultValue={dateTimeValue(product?.publishedAt)} /></label>
      </div></section>

      <div className="admin-form-actions admin-card--wide"><button className="button" type="submit">{isEdit ? "Сохранить товар" : "Создать товар"}</button><Link className="button button--outline" href="/admin/products/">Отмена</Link></div>
    </form>
  </>;
}
