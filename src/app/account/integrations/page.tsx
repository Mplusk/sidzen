import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getTochkaConfig } from "@/lib/tochka/config";
import { saveDeliveryMethod, savePaymentIntegration } from "@/app/actions/integrations";
import { OzonDeliverySettings } from "@/components/ozon-delivery-settings";
import { AdminDeleteDelivery } from "@/components/admin-delete-delivery";
import { SocialSettings } from "@/components/social-settings";
import { CloudKassirSettings } from "@/components/cloudkassir-settings";

export const metadata: Metadata = { title: "Подключения магазина", robots: { index: false, follow: false } };
const messages: Record<string, string> = {
  "cloud-saved": "Настройки CloudKassir сохранены. Автоматическая выдача чеков пока выключена.",
  "cloud-verified": "Доступ к CloudKassir и состояние кассы проверены. Проверка не создаёт чеков и не списывает деньги.",
  "cloud-invalid": "Проверьте формат Public ID, ИНН и номеров кассы и фискального накопителя.",
  "cloud-incomplete": "Сначала заполните и включите CloudKassir: Public ID, API Secret, ИНН продавца (как в реквизитах магазина), заводской номер кассы и номер ФН. Заполните реквизиты магазина и подтвердите размещение данных в России, рабочую кассу, настройки АУСН «Доходы» / без НДС и условия обработки данных.",
  "cloud-connection": "CloudKassir не подтвердил рабочую кассу. Проверьте ключи, ИНН, кассу и ФН: касса должна быть фискализирована, доступна, без блокировки, с действующим ФН и местом расчётов 3dprinta.shop. Настройки не изменены.",
  "cloud-pending": "Есть незавершённые чеки или оплаченные заказы CloudKassir, либо настройки изменились параллельно. Сменить терминал / ИНН сейчас нельзя. Секрет того же терминала можно обновить.",
  "cloud-rate": "Слишком много проверок. Повторите через минуту.",
  "social-saved": "Настройки входа сохранены. Ключи и адрес возврата проверяются при настоящем входе в сервис.",
  "social-incomplete": "Для включения нужны корректный ID, секрет (Google / Яндекс), проверка оператором условий обработки и заполненные реквизиты магазина. Для Google также нужно подтверждение при настройке сервера.",
  "social-invalid": "Проверьте ID и секрет приложения.", "social-rate": "Слишком много изменений. Повторите через минуту.", "social-changed": "Настройки изменились параллельно. Обновите страницу и повторите.",
  saved: "Настройки сохранены.", verified: "Настройки сохранены. Доступ к компании и эквайрингу Точки проверен без списания денег.",
  invalid: "Проверьте заполнение полей и тариф (до двух знаков после запятой).",
  incomplete: "Для включения нужны рабочий JWT-ключ, customerCode, merchantId, хотя бы один способ оплаты и настройки чеков. Для внешней кассы подтвердите самостоятельную выдачу чеков.",
  connection: "Проверка Точки не пройдена. Проверьте JWT-ключ и права ReadCustomerData, ReadAcquiringData, MakeAcquiringOperation. Компания должна иметь тип Business, торговая точка — статус REG и isActive=true. Карта / СБП и касса должны быть подключены в банке. Настройки не изменены.",
  pending: "Настройки изменились параллельно либо есть незавершённые платежи Точки. Нельзя менять компанию или торговую точку до сверки этих платежей. JWT-ключ той же компании можно заменить.",
  rate: "Слишком много проверок. Повторите через минуту.",
  "delivery-deleted": "Способ доставки удалён. Старые заказы и их доставка не изменены.",
  "delivery-missing": "Способ доставки уже удалён или больше не существует. Обновите страницу.",
  "delivery-confirmation": "Для удаления подтвердите выбранный способ доставки в открывшемся окне.",
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
    <label className="field">Расходы магазина на доставку, ₽<input name="basePrice" type="number" required min="0" max="999999" step="0.01" defaultValue={method?.basePrice ?? 0} /><small>Внутренний тариф перевозчика. Покупателю доставка бесплатна.</small></label>
    <label className="field">Описание и сроки<textarea name="description" maxLength={500} defaultValue={method?.description ?? ""} /></label>
    <label className="field">Порядок отображения<input name="sortOrder" type="number" min="0" max="999" defaultValue={method?.sortOrder ?? 0} required /></label>
    <label><input type="checkbox" name="active" defaultChecked={method?.active ?? true} /> Доступен при оформлении заказа</label>
    <button className="button button--small" type="submit">{method ? "Сохранить доставку" : "Добавить доставку"}</button>
  </form>;
}

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ result?: string }> }) {
  await requirePermission("settings.write");
  const [config, methods, params] = await Promise.all([getTochkaConfig(), prisma.deliveryMethod.findMany({ where: { deletedAt: null }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }), searchParams]);
  return <>
    <h1>Подключения магазина</h1><p className="notice">Сайт принимает только заявки. Все способы оплаты убраны из оформления; платёжные ссылки и чеки для новых заявок не создаются. Отправления выбранной Ozon Доставки создаются автоматически, а при удалении заявки запрашивается их отмена.</p>
    <p><Link className="text-link" href="/account/marketplaces/">Подключить Ozon / Wildberries и синхронизировать товары →</Link></p>
    {params.result && messages[params.result] && <p role="status" className="content-card">{messages[params.result]}</p>}
    <details className="content-card"><summary>Архивные платёжные интеграции — только для ранее созданных заказов</summary><p className="muted">Настройки и проверка старых обязательств сохранены. Даже включённая здесь интеграция не добавляет способы оплаты к новым заявкам.</p>
    <section className="content-card"><h2>Точка · интернет-эквайринг</h2>
      <p>Оплата новых заявок на сайте отключена. JWT-ключ: {config.token ? "сохранён, скрыт" : "не задан"}.</p>
      {config.checkedAt && <p className="muted">Последняя успешная проверка: {new Date(config.checkedAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })} МСК.</p>}
      <form action={savePaymentIntegration} className="form-grid" autoComplete="off">
        <label className="field">JWT-ключ Точка API<input type="password" name="token" autoComplete="new-password" maxLength={16000} placeholder={config.token ? "Оставьте пустым, чтобы сохранить ключ" : "Из раздела «Интеграции и API» Точки"} /><small>Ключ хранится зашифрованным. Не добавляйте префикс Bearer. Тестовый ключ песочницы не подходит.</small></label>
        <label className="field">Код компании · customerCode<input name="customerCode" defaultValue={config.customerCode} maxLength={9} /><small>9 символов. Из метода Get Customers List, компания с типом Business.</small></label>
        <label className="field">Торговая точка · merchantId<input name="merchantId" defaultValue={config.merchantId} maxLength={15} inputMode="numeric" /><small>15 цифр. Из Get Retailers для вашего сайта.</small></label>
        <label className="field">Чеки<select name="receiptMode" defaultValue={config.receiptMode}><option value="cloudkassir">CloudKassir · АУСН Доходы · без НДС</option><option value="provider">Касса, подключённая в Точке</option><option value="external">Собственная касса · ручная выдача чеков</option></select><small>Для вашей связки выберите CloudKassir и настройте его ниже. Точка получает запрос оплаты без чека. Параллельную фискализацию в банке отключите, чтобы не было дублей. Сервис Точки «Чеки» для АУСН не используется.</small></label>
        {config.receiptMode === "cloudkassir" ? <><input type="hidden" name="vatType" value="none" /><input type="hidden" name="taxSystemCode" value="usn_income" /><label className="field">НДС<input readOnly value="Без НДС" /></label><label className="field">Система налогообложения<input readOnly value="АУСН · Доходы (код ККТ: УСН Доходы)" /><small>Для CloudKassir фиксировано: TaxationSystem=1, Vat=null.</small></label></> : <><label className="field">НДС<select name="vatType" defaultValue={config.vatType}><option value="">Не выбран</option>{Object.entries({ none: "Без НДС", vat0: "НДС 0%", vat5: "НДС 5%", vat7: "НДС 7%", vat10: "НДС 10%", vat22: "НДС 22%", vat105: "НДС 5/105", vat107: "НДС 7/107", vat110: "НДС 10/110", vat122: "НДС 22/122" }).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="field">Система налогообложения<select name="taxSystemCode" defaultValue={config.taxSystemCode}><option value="">Не выбрана</option>{Object.entries({ osn: "Общая", usn_income: "УСН · доходы", usn_income_outcome: "УСН · доходы минус расходы", esn: "ЕСХН", patent: "Патент" }).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></>}
        <label><input type="checkbox" name="card" defaultChecked={config.card} /> Банковские карты</label>
        <label><input type="checkbox" name="sbp" defaultChecked={config.sbp} /> СБП</label>
        <label><input type="checkbox" name="externalReceiptsConfirmed" defaultChecked={config.externalReceiptsConfirmed} /> При выборе собственной кассы подтверждаю выдачу всех необходимых чеков самостоятельно</label>
        <label><input type="checkbox" name="enabled" defaultChecked={config.enabled} /> Принимать онлайн-платежи</label>
        <button className="button" type="submit">Сохранить</button><button className="button button--outline" type="submit" name="intent" value="check">Проверить и сохранить</button>
      </form>
      <p className="muted">При включении проверяем доступ и торговую точку без списания денег. Пустое поле сохраняет прежний ключ. «Сохранить» с выключенной оплатой позволяет сохранить незавершённые настройки. Отключение запрещает создание новых платёжных ссылок, но сохраняет проверку уже созданных.</p>
      <p>Для быстрых уведомлений подпишите своё приложение на событие <code>acquiringInternetPayment</code> методом Create Webhook (право ManageWebhookData), URL: <code>https://3dprinta.shop/api/payments/tochka/</code>. Подпись уведомлений проверяется. Без вебхука сайт сверяет платежи в фоне примерно раз в минуту и при возвращении покупателя.</p>
      <p><a className="text-link" href="https://developers.tochka.com/docs/tochka-api/opisanie-metodov/platyozhnye-ssylki" target="_blank" rel="noreferrer">Документация Точки и права API →</a></p>
    </section>
    <CloudKassirSettings />
    </details>
    <OzonDeliverySettings />
    <SocialSettings />
    <h2>Другие способы доставки</h2><p className="muted">Управляйте способами с фиксированными тарифами. Эти способы не используют API перевозчика. Ozon Delivery API подключается отдельно выше. Способ можно отключить или удалить с подтверждением — старые заказы не меняются.</p>
    {!methods.length && <p className="notice">Другие способы доставки не добавлены. При включённом Ozon покупателю доступна только Ozon Доставка.</p>}
    {methods.map((method) => <section className="content-card" key={method.id}><h3>{method.name} · {method.active ? "включён" : "выключен"}</h3><DeliveryForm method={{ ...method, basePrice: Number(method.basePrice) }} /><AdminDeleteDelivery id={method.id} name={method.name} /></section>)}
    <section className="content-card"><h3>Новый способ доставки</h3><DeliveryForm /></section>
  </>;
}
