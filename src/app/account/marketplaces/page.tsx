import Link from "next/link";
import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getConnection, getPolicy } from "@/lib/marketplaces/config";
import { providers, conflictMessages, runErrors, type Provider } from "@/lib/marketplaces/model";
import { MarketplaceProgress } from "@/components/marketplace-progress";
import { saveMarketplaceConnection, saveMarketplacePolicy, startMarketplaceSync, cancelMarketplaceSync, mapMarketplaceListing, setMarketplaceProductMode } from "@/app/actions/marketplaces";

export const metadata: Metadata = { title: "Маркетплейсы — синхронизация товаров", robots: { index: false, follow: false } };
const labels: Record<Provider, string> = { ozon: "Ozon", wb: "Wildberries" };
const statuses: Record<string, string> = { QUEUED: "В очереди", RUNNING: "Выполняется", SUCCEEDED: "Завершено", FAILED: "Ошибка", CANCELED: "Остановлено" };
const messages: Record<string, string> = {
  saved: "Настройки сохранены. Подключение проверено, если были изменены ключи.", queued: "Синхронизация поставлена в очередь.", busy: "Дождитесь завершения текущей синхронизации или остановите её.",
  connection: "Не удалось проверить подключение. Проверьте ключ, кабинет продавца и права на чтение товаров и цен. Настройки не изменены.",
  account: "Нельзя заменить кабинет продавца при существующих привязках. Используйте ключ того же кабинета.", invalid: "Проверьте заполнение полей.",
  rate: "Слишком много запросов. Повторите через минуту.", mapped: "Карточка сопоставлена с товаром сайта.",
  mapping: "Не удалось сопоставить: идентификатор занят другим товаром, есть другая привязка или данные требуют исправления на маркетплейсе.", canceled: "Синхронизация остановлена. Уже обработанные товары сохранены.",
};

export default async function MarketplacesPage({ searchParams }: { searchParams: Promise<{ result?: string; q?: string; page?: string }> }) {
  await requirePermission("settings.write"); await requirePermission("products.write"); await requirePermission("products.publish");
  const params = await searchParams;
  const query = (params.q ?? "").trim().slice(0, 100);
  const page = Math.min(10000, Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1));
  const [connections, policy, categories, runs, pending, products, linked, count] = await Promise.all([
    Promise.all(providers.map(async (provider) => { try { return await getConnection(provider); } catch { return null; } })),
    getPolicy(), prisma.category.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.marketplaceSyncRun.findMany({ take: 15, orderBy: { createdAt: "desc" } }),
    prisma.marketplaceListing.findMany({ where: { conflict: { not: null } }, take: 50, orderBy: { updatedAt: "desc" }, select: { id: true, provider: true, externalId: true, sellerSku: true, conflict: true, productId: true } }),
    prisma.product.findMany({ where: query ? { OR: [{ name: { contains: query, mode: "insensitive" } }, { sku: { contains: query, mode: "insensitive" } }] } : {}, take: 100, orderBy: { name: "asc" }, select: { id: true, name: true, sku: true } }),
    prisma.product.findMany({ where: { marketplaceListings: { some: {} } }, take: 50, skip: (page - 1) * 50, orderBy: { sku: "asc" }, select: { id: true, sku: true, name: true, marketplaceMode: true, marketplaceListings: { select: { provider: true, externalId: true, conflict: true } } } }),
    prisma.product.count({ where: { marketplaceListings: { some: {} } } }),
  ]);
  const active = runs.find((run) => ["QUEUED", "RUNNING"].includes(run.status));
  return <div className="marketplace-page">
    <h1>Маркетплейсы</h1>
    <p>Загрузка товаров из кабинетов продавца Ozon и Wildberries в единый каталог сайта. На маркетплейсах ничего не изменяется.</p>
    {params.result && messages[params.result] && <p role="status" className="content-card">{messages[params.result]}</p>}
    <MarketplaceProgress active={Boolean(active)} />
    <section className="content-card"><h2>Единые данные</h2>
      <p>Сопоставляем по артикулу продавца (без учёта регистра и лишних пробелов) и штрихкодам. Повторный импорт обновляет привязку. Спорные совпадения не создают товар автоматически.</p>
      <p>Из основного источника берём название, описание, характеристики, фото и цену продавца в рублях. Если необязательных данных нет, используем второй источник. Порядок запусков не определяет итоговые данные.</p>
      <p>Новые товары — <strong>черновики</strong>, без доступного остатка. Перед публикацией проверьте цену, категорию, варианты и наличие. Категории, артикул сайта, публикация, остатки, материалы, цвета, SEO и производственные настройки существующих товаров не меняются. Остатки складов маркетплейсов не складываем с остатком сайта.</p>
      <form action={saveMarketplacePolicy} className="form-grid">
        <label className="field">Основной источник<select name="primary" defaultValue={policy.primary}>{providers.map((provider) => <option key={provider} value={provider}>{labels[provider]}</option>)}</select></label>
        <label className="field">Категория новых товаров<select name="categoryId" defaultValue={policy.categoryId}><option value="">Назначать вручную</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
        <button className="button button--small" disabled={Boolean(active)}>Сохранить правила</button>
      </form><p className="muted">Новые правила и режим товара применяются при следующей ручной синхронизации. Ручное изменение импортируемых полей в редакторе товара переключает его в режим «Данные сайта».</p>
    </section>
    {providers.map((provider, index) => {
      const config = connections[index];
      return <section className="content-card" key={provider}><h2>{labels[provider]}</h2>
        <p>{config ? `Подключён: ${config.name}. Ключ сохранён и скрыт.` : "Не подключён"}</p>
        {config && <p className="muted">Проверено: {new Date(config.checkedAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })} МСК</p>}
        <form action={saveMarketplaceConnection} className="form-grid" autoComplete="off">
          <input type="hidden" name="provider" value={provider} />
          {provider === "ozon" && <label className="field">Client ID<input name="clientId" required maxLength={100} inputMode="numeric" defaultValue={config?.clientId ?? ""} /></label>}
          <label className="field">{provider === "ozon" ? "API Key" : "API-токен продавца"}<input type="password" name="secret" autoComplete="new-password" maxLength={10000} required={!config} placeholder={config ? "Пустое поле сохраняет прежний ключ" : "Введите ключ"} /></label>
          <button className="button button--small" disabled={Boolean(active)}>Проверить и сохранить</button>
        </form>
        <p className="muted">{provider === "ozon" ? "Нужны права Seller API на чтение товаров, цен и характеристик." : "Нужны права токена на чтение «Контент» и «Цены и скидки». Токен только для чтения достаточен."} Ключи шифруются и не показываются покупателям.</p>
        <form action={startMarketplaceSync}><input type="hidden" name="provider" value={provider} /><button className="button" disabled={!config || Boolean(active)}>Синхронизировать {labels[provider]}</button></form>
      </section>;
    })}
    <section className="content-card"><h2>Журнал синхронизаций</h2>
      {active && <form action={cancelMarketplaceSync}><input type="hidden" name="id" value={active.id} /><button className="button button--outline">Остановить текущий запуск</button></form>}
      {!runs.length && <p className="muted">Запусков пока нет.</p>}
      {runs.map((run) => <div key={run.id} style={{ borderBottom: "1px solid var(--line)", padding: "16px 0" }}><strong>{labels[run.provider as Provider] ?? run.provider} · {statuses[run.status]}</strong><p className="muted">{run.createdAt.toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })} МСК · обработано {run.processed}, создано {run.created}, обновлено {run.updated}, требуют проверки {run.conflicts}</p>{run.error && <p role="alert">{runErrors[run.error] ?? runErrors.database}</p>}{run.status === "SUCCEEDED" && run.conflicts > 0 && <p>Загрузка завершена с замечаниями — проверьте спорные карточки ниже.</p>}</div>)}
    </section>
    <section className="content-card"><h2>Требуют сопоставления</h2>
      <p>При разных артикулах и отсутствии общего штрихкода нельзя достоверно определить один и тот же товар. Укажите одинаковый артикул/штрихкод в кабинетах либо сопоставьте карточку вручную. Одинаковое название требует проверки, а не автоматического объединения.</p>
      <form method="get" className="form-grid"><label className="field">Найти товар сайта для сопоставления<input name="q" defaultValue={query} placeholder="Название или артикул" maxLength={100} /></label><button className="button button--small button--outline">Найти</button></form>
      <p className="muted">В выборе показаны первые 100 товаров; используйте поиск для остальных. Спорных карточек на странице — до 50.</p>
      {!pending.length && <p>Спорных карточек нет.</p>}
      {pending.map((listing) => <div key={listing.id} style={{ borderBottom: "1px solid var(--line)", padding: "16px 0" }}><h3>{labels[listing.provider as Provider]} · {listing.sellerSku} · ID {listing.externalId}</h3><p>{conflictMessages[listing.conflict ?? ""] ?? conflictMessages.data}</p>
        {["prices", "currency", "variant"].includes(listing.conflict ?? "") && <p className="muted">Создайте или выберите товар с корректной ценой и вариантами на сайте. Сопоставление включит режим «Данные сайта»: импорт не заменит его поля.</p>}
        <form action={mapMarketplaceListing} className="form-grid"><input type="hidden" name="id" value={listing.id} /><label className="field">Товар сайта<select name="productId" required defaultValue=""><option value="">Выберите существующий товар</option>{products.map((product) => <option key={product.id} value={product.id}>{product.sku} · {product.name}</option>)}</select></label><button className="button button--small" disabled={Boolean(active)}>Сопоставить</button></form>
      </div>)}
    </section>
    <section className="content-card"><h2>Привязанные товары · {count}</h2>
      {!linked.length && <p className="muted">Привязок пока нет.</p>}
      {linked.map((product) => <div key={product.id} style={{ borderBottom: "1px solid var(--line)", padding: "16px 0" }}><Link className="text-link" href={`/admin/products/${product.id}/`}>{product.sku} · {product.name}</Link><p className="muted">{product.marketplaceListings.map((listing) => `${labels[listing.provider as Provider]}: ${listing.externalId}${listing.conflict ? " (нужна проверка)" : ""}`).join(" · ")}</p>
        <form action={setMarketplaceProductMode} className="form-grid"><input type="hidden" name="id" value={product.id} /><label className="field">Данные карточки<select name="mode" defaultValue={product.marketplaceMode}><option value="AUTO">Из маркетплейсов по основному источнику</option><option value="SITE">Данные сайта — не перезаписывать</option></select></label><button className="button button--small button--outline" disabled={Boolean(active)}>Сохранить режим</button></form>
      </div>)}
      {page > 1 && <Link className="text-link" href={`?page=${page - 1}`}>← Предыдущие</Link>} {page * 50 < count && <Link className="text-link" href={`?page=${page + 1}`}>Следующие →</Link>}
    </section>
  </div>;
}
