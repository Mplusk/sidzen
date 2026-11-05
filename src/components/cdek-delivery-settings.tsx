import { saveCdekDelivery } from "@/app/actions/cdek-delivery";
import { SubmitButton } from "@/components/submit-button";
import { getCdekConfig } from "@/lib/delivery/cdek-config";
import { DeliveryAvailabilityToggle } from "@/components/delivery-availability-toggle";

export async function CdekDeliverySettings() {
  const config = await getCdekConfig();
  return <section className="content-card" id="cdek-delivery"><h2>СДЭК · API доставки</h2>
    <DeliveryAvailabilityToggle carrier="cdek" enabled={config.enabled} />
    <p>Доставка в ПВЗ оплачивается покупателем.</p>
    <p className="muted">Старый фиксированный способ «СДЭК» не показывается покупателям. Доставка появится после проверки ключей и включения подключения здесь. Код города и ПВЗ отправления можно найти в кабинете СДЭК. Каждая единица товара передаётся как отдельная упаковка; вес и размеры должны быть заполнены в товаре.</p>
    <p>Секрет: {config.clientSecret ? "сохранён, скрыт" : "не задан"}. {config.checkedAt && `Авторизация проверена ${new Date(config.checkedAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })} МСК.`}</p>
    <form action={saveCdekDelivery} className="form-grid" autoComplete="off">
      <label className="field">Среда<select name="environment" defaultValue={config.environment}><option value="test">Тестовая</option><option value="production">Рабочая</option></select></label>
      <label className="field">Идентификатор API<input name="clientId" maxLength={200} defaultValue={config.clientId} /></label>
      <label className="field">Секрет API<input name="clientSecret" type="password" maxLength={4000} autoComplete="new-password" placeholder={config.clientSecret ? "Пустое поле сохранит секрет" : "Ключ из кабинета СДЭК"} /></label>
      <label className="field">Код города отправления СДЭК<input name="senderCityCode" type="number" min="1" step="1" defaultValue={config.senderCityCode ?? ""} /></label>
      <label className="field">Код ПВЗ отправления<input name="senderPoint" maxLength={80} defaultValue={config.senderPoint} /></label>
      <label className="field">Имя или наименование отправителя<input name="senderName" maxLength={120} defaultValue={config.senderName} /><small>Передаётся в СДЭК как отправитель по договору.</small></label>
      <label className="field">Телефон отправителя<input name="senderPhone" type="tel" maxLength={30} defaultValue={config.senderPhone} /></label>
      <input type="hidden" name="enabled" value={config.enabled ? "on" : ""} />
      <input type="hidden" name="availabilityVersion" value={config.enabled ? "on" : "off"} />
      <div className="form-actions"><SubmitButton className="button" pendingLabel="Сохраняем…">Сохранить</SubmitButton>
      <SubmitButton className="button button--outline" name="intent" value="check" pendingLabel="Проверяем…">Проверить авторизацию</SubmitButton></div>
</form>
  </section>;
}
