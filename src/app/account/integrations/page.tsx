import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getPaymentConfig } from "@/lib/integrations";
import { saveDeliveryMethod, savePaymentIntegration } from "@/app/actions/integrations";
import { OzonDeliverySettings } from "@/components/ozon-delivery-settings";

export const metadata: Metadata = { title: "Подключения — доставка и оплата", robots: { index: false, follow: false } };
const messages: Record<string, string> = {
  saved: "Настройки сохранены.", verified: "Настройки сохранены. Ключи ЮKassa проверены.",
  invalid: "Проверьте заполнение полей и тариф (до двух знаков после запятой).",
  incomplete: "Для включения оплаты нужны Shop ID, секретный ключ и настройки чеков.",
  connection: "Проверка не пройдена. Проверьте ключ и Shop ID действующего магазина ЮKassa. Тестовый магазин на рабочем сайте не допускается. Настройки не изменены.",
  pending: "Нельзя менять платёжный магазин или ключ, пока есть незавершённые платежи. Сначала сверьте их в ЮKassa.",
  rate: "Слишком много проверок. Повторите через минуту.",
  "ozon-invalid": "Проверьте Client ID, секрет, ID метода отгрузки и срок подготовки.",
  "ozon-incomplete": "Для включения Ozon Доставки заполните Client ID, Client Secret и ID метода отгрузки.",
  "ozon-connection": "Проверка Delivery API не пройдена. Нужны ключи частного приложения Ozon Доставки с указанными правами и активный shipment_method_id. Настройки не изменены.",
  "ozon-verified": "Настройки Ozon Доставки сохранены, подключение проверено. При первом подключении ПВЗ загружаются в фоне — обновите страницу чуть позже.",
  "ozon-pending": "Настройки изменились параллельно либо есть незавершённые доставки. Нельзя сменить Client ID до их завершения.",
  "ozon-no-method": "Ключи сохранены, авторизация и доступ к ПВЗ проверены. В Ozon нет активного метода отгрузки. Создайте его в кабинете Ozon Доставки и загрузите методы здесь. Доставка покупателям пока выключена.",
  "ozon-select-method": "Ключи сохранены и проверены. Найдено несколько активных методов отгрузки — выберите нужный ID из списка и включите доставку.",
};

function DeliveryForm({ method }: { method?: { id: string; name: string; description: string | null; basePrice: number; sortOrder: number; active: boolean } }) {
  return <form action={saveDeliveryMethod} className="form-grid">
    <input type="hidden" name="id" value={method?.id ?? ""} />
    <label className="field">Название<input name="name" required maxLength={100} defaultValue={method?.name} placeholder="Курьерская доставка" /></label>
    <label className="field">Тариф, ₽<input name="basePrice" type="number" required min="0" max="999999" step="0.01" defaultValue={method?.basePrice ?? 0} /></label>
    <label className="field">Описание и сроки<textarea name="description" maxLength={500} defaultValue={method?.description ?? ""} /></label>
    <label className="field">Порядок отображения<input name="sortOrder" type="number" min="0" max="999" defaultValue={method?.sortOrder ?? 0} required /></label>
    <label><input type="checkbox" name="active" defaultChecked={method?.active ?? true} /> Доступен при оформлении заказа</label>
    <button className="button button--small" type="submit">{method ? "Сохранить доставку" : "Добавить доставку"}</button>
  </form>;
}

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ result?: string }> }) {
  await requirePermission("settings.write");
  const [config, methods, params] = await Promise.all([getPaymentConfig(), prisma.deliveryMethod.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }), searchParams]);
  return <>
    <h1>Доставка и оплата</h1><p className="muted">Подключения магазина. Доступны только администраторам с правом изменения настроек.</p>
    <p><Link className="text-link" href="/account/marketplaces/">Подключить Ozon / Wildberries и синхронизировать товары →</Link></p>
    {params.result && messages[params.result] && <p role="status" className="content-card">{messages[params.result]}</p>}
    <section className="content-card"><h2>ЮKassa</h2>
      <p>{config.enabled ? "Онлайн-оплата включена" : "Онлайн-оплата выключена"}. Ключ: {config.secret ? "сохранён, скрыт" : "не задан"}.</p>
      {config.checkedAt && <p className="muted">Последняя успешная проверка: {new Date(config.checkedAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })} МСК.</p>}
      <form action={savePaymentIntegration} className="form-grid" autoComplete="off">
        <label className="field">Shop ID<input name="shopId" defaultValue={config.shopId} maxLength={100} /></label>
        <label className="field">Секретный ключ<input type="password" name="secret" autoComplete="new-password" maxLength={500} placeholder={config.secret ? "Оставьте пустым, чтобы сохранить ключ" : "Введите ключ ЮKassa"} /></label>
        <label className="field">Чеки<select name="receiptMode" defaultValue={config.receiptMode}><option value="provider">Передавать данные чека в ЮKassa</option><option value="external">Чеки формируются отдельно продавцом</option></select></label>
        <label className="field">Код НДС ЮKassa<select name="vatCode" defaultValue={config.vatCode}><option value="">Не выбран</option>{Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}{i === 0 ? " — без НДС" : ""}</option>)}</select></label>
        <label className="field">Код системы налогообложения<select name="taxSystemCode" defaultValue={config.taxSystemCode}><option value="">Из настроек ЮKassa</option>{Array.from({ length: 6 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}</select></label>
        <label><input type="checkbox" name="enabled" defaultChecked={config.enabled} /> Принимать онлайн-платежи</label>
        <button className="button" type="submit">Сохранить</button><button className="button button--outline" type="submit" name="intent" value="check">Проверить и сохранить</button>
      </form>
      <p className="muted">При включении проверяем ключи без списания денег. Пустое поле сохраняет прежний ключ. Отключение запрещает новые оплаты, но сохраняет обработку уведомлений по существующим платежам.</p>
      <p>В кабинете ЮKassa настройте уведомления payment.succeeded и payment.canceled на адрес <code>https://3dprinta.shop/api/payments/yookassa/</code>. Карты и СБП включаются в ЮKassa. Коды для чеков выберите согласно настройкам вашей кассы: <a className="text-link" href="https://yookassa.ru/developers/api" target="_blank" rel="noreferrer">справочник ЮKassa</a>.</p>
    </section>
    <section className="content-card"><h2>Оплата по счёту</h2><p>Доступна без платёжного сервиса. Реквизиты передаются покупателю после подтверждения заказа. Онлайн-списаний этот способ не выполняет.</p></section>
    <OzonDeliverySettings />
    <h2>Другие способы доставки</h2><p className="muted">Управляйте способами с фиксированными тарифами. Эти способы не используют API перевозчика. Ozon Delivery API подключается отдельно выше. Отключённый способ исчезает из оформления новых заказов; старые заказы не меняются.</p>
    {methods.map((method) => <section className="content-card" key={method.id}><h3>{method.name} · {method.active ? "включён" : "выключен"}</h3><DeliveryForm method={{ ...method, basePrice: Number(method.basePrice) }} /></section>)}
    <section className="content-card"><h3>Новый способ доставки</h3><DeliveryForm /></section>
  </>;
}
