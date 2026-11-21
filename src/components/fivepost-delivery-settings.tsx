import { saveFivePostDelivery } from "@/app/actions/fivepost-delivery";
import { getFivePostConfig } from "@/lib/delivery/fivepost-config";
import { prisma } from "@/lib/prisma";

const messages: Record<string, string> = {
  on: "5Post включён. Доставка появится после загрузки пунктов с выбранным тарифом.",
  off: "5Post выключен для новых заказов.",
  checked: "Подключение проверено, настройки сохранены.",
  invalid: "Проверьте ключ, среду и UUID склада. Для включения заполните рабочий тариф и базовый вес.",
  connection: "5Post не подтвердил доступ к активному складу и справочнику. Проверьте среду, ключ и UUID склада.",
  changed: "Настройки уже изменились. Обновите страницу.",
  pending: "Склад и среду можно сменить после завершения текущих отправлений.",
  rate: "Повторите проверку через минуту.",
};
export async function FivePostDeliverySettings({ result }: { result?: string }) {
  const [config, directory] = await Promise.all([getFivePostConfig(), prisma.fivePostDirectory.findUnique({ where: { id: "5post" } })]);
  const version = JSON.stringify([config.checkedAt, config.enabled]);
  const message = result?.startsWith("fivepost-") ? messages[result.slice(9)] : undefined;
  return <section id="fivepost-delivery" className="content-card">
    <h2>5Post</h2>
    <p>{config.enabled ? "Включён для новых заказов" : "Выключен для новых заказов"}</p>
    {message && <p className="notice" role="status">{message}</p>}
    {config.enabled && <><form action={saveFivePostDelivery}><input type="hidden" name="version" value={version} /><button className="button button--secondary" name="intent" value="disable">Выключить 5Post</button></form>
      <p className="muted">{directory?.error === "no-rates" ? "У пунктов нет выбранного тарифа. Проверьте его название по договору." : directory?.error ? "Справочник временно не обновился. Следующая попытка запланирована." : directory?.refreshedAt ? `Пункты обновлены ${directory.refreshedAt.toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })} МСК` : "Загружаем справочник пунктов выдачи."}</p></>}
    <form action={saveFivePostDelivery} className="form-grid">
      <input type="hidden" name="version" value={version} />
      <label className="field">Среда<select name="environment" defaultValue={config.environment}><option value="test">Тестовая</option><option value="production">Рабочая</option></select></label>
      <label className="field">API-ключ 5Post<input type="password" name="apiKey" maxLength={2000} autoComplete="new-password" placeholder={config.apiKey ? "Ключ сохранён" : undefined} required={!config.apiKey} /></label>
      <label className="field">UUID склада в 5Post<input name="warehouseId" defaultValue={config.warehouseId} maxLength={36} required /></label>
      <label className="field">Тариф по договору<input name="rateType" defaultValue={config.rateType} maxLength={120} /><small>Название rateType или код rateTypeCode вашего склада приёмки.</small></label>
      <label className="field">Вес в базовом тарифе, кг<input type="number" name="baseKg" min={1} max={100} defaultValue={config.baseKg ?? ""} /></label>
      <label className="field">Код схемы сроков доставки<input name="slCode" type="number" min={1} defaultValue={config.slCode ?? ""} /><small>Необязательный slCode из договора.</small></label>
      <label><input type="checkbox" name="buyerPays" defaultChecked={config.buyerPays} /> Доставку оплачивает покупатель</label>
      <div className="field field--full"><div className="actions"><button className="button button--secondary" name="intent" value="check">Проверить и сохранить</button> <button className="button" name="intent" value="enable">{config.enabled ? "Сохранить и оставить включённым" : "Включить 5Post"}</button></div></div>
    </form>
  </section>;
}
