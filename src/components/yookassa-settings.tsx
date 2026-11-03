import { saveYooKassaSettings } from "@/app/actions/yookassa-settings";
import { SubmitButton } from "@/components/submit-button";
import { getYooKassaConfig } from "@/lib/yookassa/config";

export async function YooKassaSettings() {
  const config = await getYooKassaConfig();
  return <section className="content-card" id="yookassa-online">
    <h2>ЮKassa · оплата и чеки</h2>
    <p>Оплата сразу при оформлении. Чеки отправляет сервис «Чеки от ЮKassa» на email покупателя. Для товаров и доставки указано «без НДС»; система АУСН настраивается в кабинете ЮKassa.</p>
    <p className="muted">{config.enabled ? "Оплата включена." : "Оплата выключена."} Секретный ключ: {config.secret ? "сохранён, скрыт" : "не задан"}. {config.checkedAt && `Подключение проверено ${new Date(config.checkedAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })} МСК.`}</p>
    <form action={saveYooKassaSettings} className="form-grid" autoComplete="off">
      <label className="field">Идентификатор магазина (shopId)<input name="shopId" inputMode="numeric" maxLength={32} defaultValue={config.shopId} /></label>
      <label className="field">Секретный ключ<input name="secret" type="password" maxLength={2000} autoComplete="new-password" placeholder={config.secret ? "Оставьте пустым, чтобы сохранить ключ" : "Секретный ключ ЮKassa"} /></label>
      <label className="field--full"><input type="checkbox" name="receiptsConfirmed" defaultChecked={config.receiptsConfirmed} /> Подтверждаю, что для этого магазина подключены «Чеки от ЮKassa», а система АУСН и реквизиты кассы настроены в ЮKassa.</label>
      <label className="field--full"><input type="checkbox" name="enabled" defaultChecked={config.enabled} /> Принимать онлайн-оплату новых заказов</label>
      <SubmitButton className="button" pendingLabel="Сохраняем…">Сохранить</SubmitButton>
      <SubmitButton className="button button--outline" name="intent" value="check" pendingLabel="Проверяем…">Проверить и сохранить</SubmitButton>
    </form>
    <p className="muted">Проверка подключения не проводит платёж. Настройте уведомления ЮKassa на адрес <code>https://sidzen.shop/api/payments/yookassa/</code> для событий payment.succeeded, payment.canceled и refund.succeeded.</p>
  </section>;
}
