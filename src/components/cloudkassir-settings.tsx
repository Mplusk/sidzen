import { SubmitButton } from "@/components/submit-button";
import { saveCloudIntegration } from "@/app/actions/cloudkassir";
import { cloudReady, getCloudConfig } from "@/lib/cloudkassir/config";
import { getStoreContacts } from "@/lib/settings";
export async function CloudKassirSettings() {
  const [config, contacts] = await Promise.all([getCloudConfig(), getStoreContacts()]);
  return <section id="cloudkassir" className="content-card"><h2>CloudKassir · онлайн-касса</h2>
    <p>{cloudReady(config) ? "Автоматическая выдача чеков включена" : "Автоматическая выдача чеков выключена"}. Точка принимает оплату, CloudKassir выдаёт чеки. Сервис «Чеки» Точки не используется.</p>
    <p className="notice">Настроено для АУСН «Доходы», без НДС. В API кассы: TaxationSystem=1, Vat=null (не НДС 0%). Касса должна быть зарегистрирована с соответствующим кодом УСН «Доходы» для АУСН; подтвердите настройки у CloudKassir.</p>
    {config.checkedAt && <p>Доступ и состояние кассы проверены {new Date(config.checkedAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })} МСК. Проверка не выпускает чек и не списывает деньги.</p>}
    <form action={saveCloudIntegration} className="form-grid" autoComplete="off">
      <label className="field">Public ID<input name="publicId" maxLength={128} defaultValue={config.publicId} /><small>Настройки сайта в кабинете CloudKassir / CloudPayments. Это не JWT Точки.</small></label>
      <label className="field">API Secret<input name="apiSecret" type="password" maxLength={2048} autoComplete="new-password" placeholder={config.apiSecret ? "Сохранён, скрыт. Пустое поле сохраняет ключ" : "Секрет CloudKassir"} /><small>Хранится зашифрованным. При смене Public ID прежний секрет не переносится.</small></label>
      <label className="field">ИНН продавца<input name="inn" inputMode="numeric" maxLength={12} defaultValue={config.inn || contacts.inn} /><small>Должен совпадать с ИНН в реквизитах магазина и регистрации ККТ.</small></label>
      <label className="field">Заводской номер ККТ · DeviceNumber<input name="deviceNumber" inputMode="numeric" maxLength={24} defaultValue={config.deviceNumber} /></label>
      <label className="field">Номер фискального накопителя · FiscalNumber<input name="fiscalNumber" inputMode="numeric" maxLength={16} defaultValue={config.fiscalNumber} /><small>16 цифр. Оба номера выдаёт CloudKassir после подключения кассы.</small></label>
      <label className="field">Налоги<input readOnly value="АУСН · Доходы / Без НДС" /></label>
      <label className="field--full"><input name="productionConfirmed" type="checkbox" defaultChecked={config.productionConfirmed} /> Подключена рабочая, не тестовая касса, зарегистрированная в ФНС для сайта sidzen.shop</label>
      <label className="field--full"><input name="taxConfirmed" type="checkbox" defaultChecked={config.taxConfirmed} /> Настройки кассы для АУСН «Доходы» и «Без НДС» подтверждены</label>
      <label className="field--full"><input name="operatorReviewed" type="checkbox" defaultChecked={config.operatorReviewed} /> Проверены договоры с CloudKassir и ОФД, основания передачи email и хранение персональных данных</label>
      <label><input name="clearSecret" type="checkbox" /> Удалить секрет</label>
      <label><input name="enabled" type="checkbox" defaultChecked={config.enabled} /> Разрешить автоматические чеки для новых платежей</label>
      <SubmitButton className="button" pendingLabel="Сохраняем…">Сохранить CloudKassir</SubmitButton><SubmitButton className="button button--outline" name="intent" value="check" pendingLabel="Проверяем…">Проверить кассу и сохранить</SubmitButton>
    </form>
    <p>После включения выберите в настройках Точки «CloudKassir · АУСН Доходы · без НДС». В CloudKassir включите уведомление Receipt: POST, формат «ключ=значение», адрес <code>https://sidzen.shop/api/fiscal/cloudkassir/</code>. Проверяется Content-HMAC. Без уведомлений работает фоновая проверка.</p>
    <p className="muted">Чек предоплаты — после подтверждения оплаты Точкой. Полный расчёт — при подтверждении фактической передачи товара покупателю, а не при отправке в ПВЗ. Полный возврат — после подтверждения возврата банком. Частичные возвраты требуют ручного оформления в кассе. Отключение новых чеков не прекращает обработку уже возникших обязательств. Не включайте параллельную фискализацию в банке.</p>
  </section>;
}
