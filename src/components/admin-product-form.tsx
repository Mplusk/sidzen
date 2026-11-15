import { SubmitButton } from "@/components/submit-button";
import Link from "next/link";
import { AdminProductImages } from "@/components/admin-product-images";
import { ProductCategoryControl } from "@/components/product-category-control";
import { createProductAction, updateProductAction } from "@/app/actions/admin";
import { PRODUCT_STATUSES, PRODUCT_TYPES, ROBOTS_VALUES } from "@/lib/product-admin";

import { currentProductSpecifications } from "@/lib/retired-product-options";

type Option = { id: string; name: string };
type ColorOption = Option & { hex: string };

export type ProductFormOptions = {
  categories: Option[];
  materials: Option[];
  colors: ColorOption[];
};

export type ProductFormValue = {
  id: string;
  updatedAt: Date;
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
  reservedStock: number;
  madeToOrder: boolean;
  leadDays: number;
  weightGrams: number | null;
  widthMm: number | null;
  depthMm: number | null;
  heightMm: number | null;
  shippingWeightG: number | null;
  shippingLengthMm: number | null;
  shippingWidthMm: number | null;
  shippingHeightMm: number | null;
  ozonDeclaredValue: number | null;
  modelAsset: string | null;
  title: string | null;
  metaDescription: string | null;
  h1: string | null;
  canonical: string | null;
  robots: (typeof ROBOTS_VALUES)[number];
  publishedAt: Date | null;
  categoryIds: string[];
  primaryCategoryId: string;
  categoryMode?: string;
  materialIds: string[];
  colorIds: string[];
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

export function AdminProductForm({ options, product, error, canPublish = true, aiReady = false, aiMessage }: { options: ProductFormOptions; product?: ProductFormValue; error?: string; canPublish?: boolean; aiReady?: boolean; aiMessage?: string }) {
  const isEdit = Boolean(product);
  const firstCategory = product ? product.primaryCategoryId : (aiReady ? "" : options.categories[0]?.id) || "";
  const specificationsText = product?.specifications ? JSON.stringify(currentProductSpecifications(product.specifications), null, 2) : "";
  const errorMessage = error === "stale" ? "Товар изменился после открытия формы. Проверьте актуальные данные и остаток, затем повторите изменения и сохраните их." : error === "reserved-stock" ? "Остаток не может быть меньше количества товаров, зарезервированных в заказах." : error === "marketplace-busy" ? "Сейчас идёт синхронизация маркетплейсов. Дождитесь завершения или остановите её в ЛК → Маркетплейсы, затем сохраните товар." : error === "duplicate" ? "Slug или артикул уже используются другим товаром, в том числе в привязках маркетплейсов." : error === "images" ? "Проверьте список изображений и формат загружаемых файлов." : error === "specifications" ? "Характеристики должны быть корректным JSON-объектом." : error ? "Проверьте заполнение полей товара." : null;

  return <>
    {error === "ai-disabled" && <p className="notice notice--danger">DeepSeek выключен или не подключён. Подключите его в ЛК → Подключения магазина или выберите категорию вручную.</p>}
    {errorMessage && error !== "ai-disabled" && <p className="notice notice--danger" role="alert">{errorMessage}</p>}
    {product?.status === "PUBLISHED" && product.stock <= 0 && !product.madeToOrder && <p className="notice" role="status">Товар виден в каталоге, но недоступен для покупки: остаток равен нулю, изготовление под заказ выключено. Укажите реальный остаток или включите «Изготавливается под заказ», если вы принимаете такие заказы.</p>}
    {product && <p className="muted">Если товар привязан к маркетплейсу, изменение названия, описания, цены, характеристик или фотографий защищает данные сайта от перезаписи. Возобновить импорт этих полей можно в <Link className="text-link" href="/account/marketplaces/">ЛК → Маркетплейсы</Link>.</p>}
    <form action={isEdit ? updateProductAction : createProductAction} className="admin-grid">
      {product && <><input type="hidden" name="id" value={product.id} /><input type="hidden" name="productVersion" value={product.updatedAt.toISOString()} /><input type="hidden" name="originalStock" value={product.stock} /><input type="hidden" name="originalReservedStock" value={product.reservedStock} /><input type="hidden" name="originalBasePrice" value={product.basePrice} /><input type="hidden" name="originalOldPrice" value={product.oldPrice ?? ""} /></>}

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
        <label className="field"><span>Остаток, шт.</span><input name="stock" type="number" min="0" step="1" defaultValue={product?.stock ?? 0} required />{product && product.reservedStock > 0 && <small>В том числе зарезервировано в заказах: {product.reservedStock} шт.</small>}</label>
        <label className="field"><span>Срок изготовления, дней</span><input name="leadDays" type="number" min="1" max="3650" step="1" defaultValue={product?.leadDays ?? 3} required /></label>
        <label className="admin-check admin-check--standalone"><input name="madeToOrder" type="checkbox" defaultChecked={product?.madeToOrder ?? false} /><span><strong>Изготавливается под заказ</strong><small>Показывать срок вместо обычного наличия</small></span></label>
      </div></section>

      <section className="admin-card admin-card--wide"><div className="catalog-section-heading"><h2>Категории</h2><Link className="text-link" href="/admin/catalog/#category">Создать или удалить категорию</Link></div><div className="form-grid">
        <ProductCategoryControl categories={options.categories} initialCategoryId={firstCategory} initialMode={product?.categoryMode ?? (aiReady ? "AI" : "MANUAL")} aiReady={aiReady} />
        {aiMessage && <p className="field--full notice" role="status">{aiMessage}</p>}
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
        <p className="field--full muted">Для Ozon Доставки: одна единица товара — отдельная упакованная посылка. В автоматическом режиме вес и габариты упаковки загружаются из Ozon Seller API. Характеристики самого изделия загружаются отдельно, если указаны. В режиме «Данные сайта» импорт заполняет только пустые измерения; упаковку загружает, только если все четыре поля пустые. Если фактическая упаковка для сайта отличается, введите измеренные значения — режим «Данные сайта» защитит их от перезаписи.</p>
        <label className="field"><span>Вес с упаковкой, г</span><input name="shippingWeightG" type="number" min="1" max="1000000" step="1" defaultValue={product?.shippingWeightG ?? ""} /></label>
        <label className="field"><span>Длина упаковки, мм</span><input name="shippingLengthMm" type="number" min="1" max="10000" step="1" defaultValue={product?.shippingLengthMm ?? ""} /></label>
        <label className="field"><span>Ширина упаковки, мм</span><input name="shippingWidthMm" type="number" min="1" max="10000" step="1" defaultValue={product?.shippingWidthMm ?? ""} /></label>
        <label className="field"><span>Высота упаковки, мм</span><input name="shippingHeightMm" type="number" min="1" max="10000" step="1" defaultValue={product?.shippingHeightMm ?? ""} /></label>
        <label className="field field--full"><span>Объявленная стоимость для Ozon, ₽</span><input name="ozonDeclaredValue" type="number" min="0.01" max="9999999999.99" step="0.01" defaultValue={product?.ozonDeclaredValue ?? ""} /><small>Действительная стоимость одной единицы товара для страхования доставки. Если поле не заполнено, используется цена товара.</small></label>
        <label className="field field--full"><span>Путь к файлу модели</span><input name="modelAsset" defaultValue={product?.modelAsset ?? ""} maxLength={500} placeholder="/private/..." /></label>
      </div></section>

      <section className="admin-card"><h2>Характеристики</h2><label className="field"><span>JSON-объект</span><textarea className="admin-code-field" name="specificationsText" defaultValue={specificationsText} placeholder={'{\n  "Материал": "PLA",\n  "Допуск": "±0,3 мм"\n}'} /><small>Заполненные характеристики появятся в карточке покупателя. ТН ВЭД и ОКПД 2 сохраняются только для администратора и на витрине не показываются.</small></label></section>

      <section className="admin-card admin-card--wide"><div className="catalog-section-heading"><h2>Материалы и цвета</h2><Link className="text-link" href="/admin/catalog/#material">Управлять справочниками</Link></div><div className="admin-relations">
        <div><h3>Материалы</h3><CheckboxGroup name="materialIds" options={options.materials} selected={product?.materialIds} /></div>
        <div><h3>Цвета</h3><CheckboxGroup name="colorIds" options={options.colors} selected={product?.colorIds} renderDetail={(option) => <small className="admin-option-detail"><i className="color-dot" style={{ "--dot": (option as ColorOption).hex } as React.CSSProperties} /></small>} /></div>
      </div></section>

      <section className="admin-card admin-card--wide"><h2>Фотографии товара</h2><AdminProductImages key={JSON.stringify(product?.images ?? [])} initialImages={product?.images ?? []} /></section>

      <section className="admin-card admin-card--wide"><h2>SEO и публикация</h2><div className="form-grid">
        <label className="field"><span>Title</span><input name="title" defaultValue={product?.title ?? ""} maxLength={180} /></label>
        <label className="field"><span>H1</span><input name="h1" defaultValue={product?.h1 ?? ""} maxLength={180} /></label>
        <label className="field field--full"><span>Meta description</span><textarea name="metaDescription" defaultValue={product?.metaDescription ?? ""} maxLength={500} /></label>
        <label className="field"><span>Canonical URL</span><input name="canonical" defaultValue={product?.canonical ?? ""} maxLength={500} placeholder="/catalog/category/product/" /></label>
        <label className="field"><span>Robots</span><select name="robots" defaultValue={product?.robots ?? "index,follow"}>{ROBOTS_VALUES.map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
        <label className="field"><span>Дата публикации</span><input name="publishedAt" type="datetime-local" defaultValue={dateTimeValue(product?.publishedAt)} /></label>
      </div></section>

      <div className="admin-form-actions admin-card--wide"><SubmitButton className="button" pendingLabel="Сохраняем…">{isEdit ? "Сохранить товар" : "Создать товар"}</SubmitButton><Link className="button button--outline" href="/admin/products/">Отмена</Link></div>
    </form>
  </>;
}
