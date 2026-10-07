"use client";

import Link from "next/link";
import { useState } from "react";
import { useFormStatus } from "react-dom";
import { createOrderAction } from "@/app/actions/checkout";
import { formatPrice } from "@/lib/format";
import { phoneMask } from "@/lib/phone-input";
import { OzonDeliveryPicker, type DeliveryQuoteView } from "@/components/ozon-delivery-picker";
import { customerDeliveryPrice } from "@/lib/delivery/pricing";
import { ValidatedInput } from "@/components/validated-input";

type Delivery = { code: string; name: string; description: string | null; basePrice: number };
const deliveryErrors: Record<string, string> = {
  "ozon": "Не удалось подтвердить доставку. Проверьте ПВЗ и повторите расчёт.",
  "ozon-expired": "Истекли 15 минут действия расчёта. Проверьте доставку в ПВЗ заново.",
  "ozon-cart": "Изменились товары, цена или упаковка. Проверьте корзину и рассчитайте доставку заново.",
  "ozon-config": "Магазин обновил настройки доставки. Проверьте ПВЗ заново.",
  "ozon-phone": "Изменился телефон получателя. Проверьте доставку с текущим номером заново.",
  "ozon-signature": "Расчёт доставки отсутствует или повреждён. Проверьте ПВЗ заново.",
  "ozon-consent": "Согласие на проверку Ozon отсутствует, отозвано или устарело. Подтвердите его и повторите расчёт.",
  "ozon-transport": "Ozon не ответил на повторную проверку. Повторите расчёт чуть позже.",
  "ozon-provider": "Ozon вернул ошибку при повторной проверке доставки. Повторите расчёт или обратитесь в магазин.",
  "ozon-recipient": "Ozon не подтвердил доставку получателю. Проверьте, что телефон зарегистрирован на Ozon.",
  "ozon-unavailable": "Ozon не подтвердил доставку всех товаров в этот ПВЗ. Попробуйте другой пункт.",
  "ozon-price": "Ozon изменил расходы магазина на перевозку. Проверьте доставку заново; для вас она остаётся бесплатной.",
  "ozon-disabled": "Доставка Ozon временно выключена магазином. Повторите позже.",
  "ozon-credentials": "Ozon отклонил подключение магазина. Сообщите об этом продавцу.",
  "ozon-rate": "Ozon ограничил частоту проверок. Повторите чуть позже.",
};
function Submit({ needsQuote, noDelivery }: { needsQuote: boolean; noDelivery: boolean }) {
  const { pending } = useFormStatus();
  return <button className="button" type="submit" disabled={pending || needsQuote || noDelivery} aria-busy={pending}>{pending ? "Отправляем заявку…" : noDelivery ? "Доставка временно недоступна" : needsQuote ? "Сначала подтвердите ПВЗ" : "Отправить заявку"}</button>;
}

export function CheckoutForm({ items, methods, user, error, reference, ozonDelivery = false, ozonUnavailable, packingReady = true }: {
  items: Array<{ id: string; name: string; configuration: string; quantity: number; total: number }>;
  methods: Delivery[]; user: { name: string; email: string; phone: string }; error?: string; reference?: string;
  ozonDelivery?: boolean;
  ozonUnavailable?: string;
  packingReady?: boolean;
}) {
  const [delivery, setDelivery] = useState(methods[0]?.code ?? (ozonDelivery ? "ozon-delivery" : ""));
  const [ozonQuote, setOzonQuote] = useState<DeliveryQuoteView | null>(null);
  const [phone, setPhone] = useState(phoneMask(user.phone));
  const changePhone = (value: string) => { const next = phoneMask(value); setPhone(next); if (next !== phone) setOzonQuote(null); };
  const changeDelivery = (code: string) => { setDelivery(code); setOzonQuote(null); };
  const subtotal = items.reduce((sum, item) => sum + item.total, 0);
  const isOzon = delivery === "ozon-delivery";
  const deliveryPrice = customerDeliveryPrice();
  const total = subtotal + deliveryPrice;
  return <form action={createOrderAction} className="commerce-grid checkout-form">
    <div className="checkout-panel">
      {error && <p className="notice notice--danger" role="alert">{deliveryErrors[error] ?? (error === "price" ? "Цена или условия доставки изменились. Проверьте обновлённую сумму и отправьте заявку заново." : "Проверьте контактные данные, адрес и согласие с условиями.")}{reference && /^[a-f0-9-]{36}$/i.test(reference) && <><br /><small>Код обращения: {reference}</small></>}</p>}
      <p className="notice">Это заявка без оплаты на сайте. Продавец свяжется с вами, подтвердит наличие и согласует дальнейшие действия.</p>
      <h2>Контактные данные</h2><div className="form-grid">
        <label className="field"><span>ФИО получателя *</span><ValidatedInput aria-label="ФИО получателя" name="name" autoComplete="name" defaultValue={user.name} required minLength={2} maxLength={120} /></label>
        <label className="field"><span>Телефон *</span><ValidatedInput aria-label="Телефон" name="phone" type="tel" autoComplete="tel" inputMode="tel" value={phone} onChange={event => changePhone(event.target.value)} placeholder="+7 (999) 123-45-67" pattern="\+7 \([0-9]{3}\) [0-9]{3}-[0-9]{2}-[0-9]{2}" required /><small>Для связи по заказу и доставке</small></label>
        <label className="field field--full"><span>Email *</span><ValidatedInput aria-label="Email" name="email" type="email" autoComplete="email" defaultValue={user.email} required /></label>
      </div>
      <fieldset className="checkout-delivery"><legend>Доставка · бесплатно</legend>{methods.map((method) => <label className="delivery-option" key={method.code}><input type="radio" name="delivery" value={method.code} checked={delivery === method.code} onChange={() => changeDelivery(method.code)} required /><span><strong>{method.name}</strong><small>{method.description}</small></span><strong>Бесплатно</strong></label>)}{ozonDelivery && <label className="delivery-option"><input type="radio" name="delivery" value="ozon-delivery" checked={isOzon} onChange={() => changeDelivery("ozon-delivery")} /><span><strong>Ozon Доставка</strong><small>В пункт выдачи или постамат · выбор ПВЗ на карте</small></span><strong>Бесплатно</strong></label>}</fieldset>
      {!ozonDelivery && <div className="delivery-option delivery-option--unavailable" aria-disabled="true"><span><strong>Ozon Доставка</strong><small>{ozonUnavailable ?? "Временно недоступна. Выберите другой способ доставки."}</small></span></div>}
      {isOzon && <><OzonDeliveryPicker phone={phone} onPhoneChange={changePhone} onQuote={setOzonQuote} packingReady={packingReady} /><input type="hidden" name="ozonQuote" value={ozonQuote?.token ?? ""} /></>}
      {delivery !== "pickup" && !isOzon && <div className="form-grid"><label className="field"><span>Город *</span><input name="city" autoComplete="address-level2" required minLength={2} maxLength={120} /></label><label className="field"><span>Индекс{delivery === "russian-post" ? " *" : ""}</span><input name="postalCode" autoComplete="postal-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required={delivery === "russian-post"} placeholder="6 цифр" /></label><label className="field field--full"><span>Улица, дом, квартира или пункт выдачи *</span><input name="address" autoComplete="street-address" required minLength={4} maxLength={300} /></label></div>}
      {delivery === "pickup" && <p className="notice">Место и время самовывоза согласуем при подтверждении заказа.</p>}
      <label className="field"><span>Комментарий</span><textarea name="comment" maxLength={1000} placeholder="Пожелания к заказу и удобное время для связи" /></label>
      <p className="muted">Контактные данные и адрес нужны для обработки заявки и согласования заказа. <Link className="text-link" href="/legal/privacy/" target="_blank">Как обрабатываются данные и кому передаются</Link>. Не указывайте в комментарии паспортные данные или реквизиты карты.</p>
      <label className="checkout-consent"><input type="checkbox" name="legal" required /><span>Принимаю <Link href="/legal/offer/" target="_blank">условия оформления заявки</Link> и прошу связаться со мной по заказу. Это не согласие на рекламу или рассылки.</span></label>
    </div>
    <aside className="order-summary"><h2>Ваша заявка</h2><ul className="checkout-items">{items.map((item) => <li key={item.id}><strong>{item.name} × {item.quantity}</strong><small>{item.configuration}</small><span>{formatPrice(item.total)}</span></li>)}</ul><div className="summary-line"><span>Товары</span><strong>{formatPrice(subtotal)}</strong></div><div className="summary-line"><span>Доставка</span><strong>Бесплатно · 0 ₽</strong></div><div className="summary-line summary-line--total" aria-live="polite" aria-atomic="true"><span>Стоимость товаров</span><strong>{formatPrice(total)}</strong></div><input type="hidden" name="expectedTotal" value={total.toFixed(2)} /><Submit needsQuote={isOzon && !ozonQuote} noDelivery={!methods.length && !ozonDelivery} /><p>Ничего оплачивать сейчас не нужно. Состав заявки и контакты получит продавец. Если выбрана Ozon Доставка, передадим имя и телефон получателя, ПВЗ и параметры посылок в Ozon для создания отправления.</p></aside>
  </form>;
}
