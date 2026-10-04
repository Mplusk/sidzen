import { saveOzonDelivery } from "@/app/actions/ozon-delivery";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getOzonDeliveryConfig } from "@/lib/delivery/ozon-config";

export async function OzonDeliverySettings() {
  const [config, sync] = await Promise.all([getOzonDeliveryConfig(), prisma.ozonDeliverySync.findUnique({ where: { id: "ozon" } })]);
  const count = config.shipmentMethodId ? await prisma.ozonDeliveryPoint.count({ where: { clientId: config.clientId, methodId: BigInt(config.shipmentMethodId), active: true } }) : 0;
  const missingPackaging = await prisma.product.count({ where: { status: "PUBLISHED", type: { in: ["READY", "PARAMETRIC"] }, OR: [{ shippingWeightG: null }, { shippingLengthMm: null }, { shippingWidthMm: null }, { shippingHeightMm: null }] } });
  return <section className="content-card" id="ozon-delivery"><h2>Ozon Доставка · Delivery API</h2>
    <p>{config.enabled ? "Доставка включена" : "Доставка выключена"}. Секрет: {config.clientSecret ? "сохранён, скрыт" : "не задан"}.</p>
    {!!missingPackaging && <p className="notice notice--danger">У {missingPackaging} опубликованных товаров не заполнены вес и габариты упакованной посылки. Для них Ozon не сможет рассчитать доставку. Заполните реальные измерения в <Link className="text-link" href="/admin/products/">редакторе товаров</Link>; размеры самого изделия не заменяют параметры упаковки.</p>}
    <p className="muted">Это отдельное подключение Ozon Доставки для бизнеса, не Seller API для товаров. Создайте частное приложение в <a className="text-link" href="https://seller.ozon.ru/app/settings/private-apps" target="_blank" rel="noreferrer">кабинете Ozon Доставки</a> и скопируйте client_id / client_secret.</p>
    <p>Права приложения: <code>delivery-api.shipment-method</code>, <code>delivery-api.delivery</code>, <code>delivery-api.delivery-point</code>, <code>delivery-api.order</code>, <code>delivery-api.posting</code>. В Ozon заранее настройте активный метод отгрузки, пункт передачи заказов и возвратов.</p>
    {config.checkedAt && <p className="muted">Проверено: {new Date(config.checkedAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })} МСК. {config.methodName}</p>}
    {config.authorizedAt && !config.checkedAt && <p className="notice">Ключи сохранены, доступ к API проверен. {config.methods?.some(method => method.status === "active") ? "Выберите активный метод отгрузки ниже." : "В Ozon ещё нет активного метода отгрузки. Создайте его в кабинете Ozon Доставки, затем нажмите «Загрузить методы отгрузки». До этого доставка покупателям выключена."}</p>}
    <form action={saveOzonDelivery} className="form-grid" autoComplete="off">
      <label className="field">Client ID<input name="clientId" maxLength={200} defaultValue={config.clientId} /></label>
      <label className="field">Client Secret<input name="clientSecret" type="password" maxLength={4000} autoComplete="new-password" placeholder={config.clientSecret ? "Пустое поле сохранит прежний секрет" : "Секрет частного приложения"} /></label>
      <label className="field">ID метода отгрузки Ozon<input name="shipmentMethodId" type="number" list="ozon-shipment-methods" min="1" step="1" defaultValue={config.shipmentMethodId ?? ""} /><small>Для сохранения ключей можно оставить пустым. Единственный активный метод выберется автоматически; если их несколько, выберите нужный ID.</small></label>
      <datalist id="ozon-shipment-methods">{config.methods?.filter(method => method.status === "active").map(method => <option key={method.shipment_method_id} value={method.shipment_method_id}>{method.name}</option>)}</datalist>
      <label className="field">Подготовка к отгрузке, дней<input name="dispatchDays" type="number" min="1" max="30" step="1" defaultValue={config.dispatchDays} /><small>Для изделий под заказ учитывается также срок изготовления товара.</small></label>
      <label><input name="enabled" type="checkbox" defaultChecked={config.enabled} /> Предлагать Ozon Доставку покупателям</label>
      <button className="button" type="submit">Сохранить Delivery API</button>
      <button className="button button--outline" type="submit" name="intent" value="check">Проверить подключение</button>
      <button className="button button--outline" type="submit" name="intent" value="methods">Загрузить методы отгрузки</button>
      <button className="button button--outline" type="submit" name="intent" value="points">Обновить список ПВЗ</button>
    </form>
    {!!config.methods?.length && <p className="muted">Методы Ozon: {config.methods.map(method => `${method.name} · ID ${method.shipment_method_id} · ${method.status === "active" ? "активен" : method.status}`).join("; ")}.</p>}
    <p>ПВЗ в справочнике: {count}. {sync ? `Обновление: ${{ PENDING: "в очереди", RUNNING: "загружается", SUCCEEDED: "завершено", FAILED: "ошибка — проверьте доступ и повторите обновление" }[sync.status] || sync.status}. Обработано страниц: ${sync.pages}.` : "После подключения список загрузится в фоне."}</p>
    <p className="muted">Проверка не создаёт отправлений. Доставка пока подключается до ПВЗ и постаматов, без курьера. Для покупателя доставка бесплатная. Тариф и страховку Ozon оплачивает магазин; эти расходы сохраняются отдельно от суммы заказа. Нужен зарегистрированный на Ozon номер покупателя. В каждом товаре заполните вес и размеры упаковки. Каждая единица товара оформляется отдельной посылкой; объединение в одну коробку не выполняется.</p>
    <p className="muted">Оплаченные заказы передаются автоматически. Для оплаты по счёту сначала подтвердите оплату или заказ в управлении заказами. Там же доступны статусы Ozon и этикетки. Отключение скрывает способ для новых заказов, но сохраняет обработку уже созданных.</p>
    <a className="text-link" href="https://docs.ozon.ru/api/ozon-delivery/" target="_blank" rel="noreferrer">Документация Ozon Delivery API →</a>
  </section>;
}
