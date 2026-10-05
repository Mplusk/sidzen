"use client";

import Link from "next/link";
import { useState } from "react";
import { useFormStatus } from "react-dom";
import { createOrderAction } from "@/app/actions/checkout";
import { formatPrice } from "@/lib/format";
import { phoneMask } from "@/lib/phone-input";
import { OzonDeliveryPicker, type DeliveryQuoteView } from "@/components/ozon-delivery-picker";
import { customerDeliveryPrice } from "@/lib/delivery/pricing";

type Delivery = { code: string; name: string; description: string | null; basePrice: number };
function Submit({ total, online, needsQuote, noDelivery }: { total: number; online: boolean; needsQuote: boolean; noDelivery: boolean }) {
  const { pending } = useFormStatus();
  return <button className="button" type="submit" disabled={pending || needsQuote || noDelivery}>{pending ? "Оформляем…" : noDelivery ? "Доставка временно недоступна" : needsQuote ? "Сначала подтвердите ПВЗ" : `${online ? "Перейти к оплате" : "Оформить заказ"} · ${formatPrice(total)}`}</button>;
}

export function CheckoutForm({ items, methods, user, onlinePayment, error, ozonDelivery = false, ozonUnavailable, packingReady = true }: {
  items: Array<{ id: string; name: string; configuration: string; quantity: number; total: number }>;
  methods: Delivery[]; user: { name: string; email: string; phone: string }; onlinePayment: boolean; error?: string;
  ozonDelivery?: boolean;
  ozonUnavailable?: string;
  packingReady?: boolean;
}) {
  const [delivery, setDelivery] = useState(methods[0]?.code ?? (ozonDelivery ? "ozon-delivery" : ""));
  const [ozonQuote, setOzonQuote] = useState<DeliveryQuoteView | null>(null);
  const [payment, setPayment] = useState(onlinePayment ? "yookassa" : "manual");
  const [phone, setPhone] = useState(phoneMask(user.phone));
  const changePhone = (value: string) => { const next = phoneMask(value); setPhone(next); if (next !== phone) setOzonQuote(null); };
  const changeDelivery = (code: string) => { setDelivery(code); setOzonQuote(null); };
  const subtotal = items.reduce((sum, item) => sum + item.total, 0);
  const isOzon = delivery === "ozon-delivery";
  const deliveryPrice = customerDeliveryPrice();
  const total = subtotal + deliveryPrice;
  return <form action={createOrderAction} className="commerce-grid checkout-form">
    <div className="checkout-panel">
      {error && <p className="notice notice--danger" role="alert">{error === "ozon" ? "Расчёт Ozon устарел или условия изменились. Выберите ПВЗ и рассчитайте доставку заново." : error === "price" ? "Цена или условия доставки изменились. Проверьте обновлённую сумму и подтвердите заказ." : error === "payment" ? "Онлайн-оплата временно недоступна. Выберите счёт или повторите попытку позже." : "Проверьте контактные данные, адрес и согласие с условиями."}</p>}
      <h2>Контактные данные</h2><div className="form-grid">
        <label className="field"><span>ФИО получателя *</span><input name="name" autoComplete="name" defaultValue={user.name} required minLength={2} maxLength={120} /></label>
        <label className="field"><span>Телефон *</span><input name="phone" type="tel" autoComplete="tel" inputMode="tel" value={phone} onChange={event => changePhone(event.target.value)} placeholder="+7 (999) 123-45-67" pattern="\+7 \([0-9]{3}\) [0-9]{3}-[0-9]{2}-[0-9]{2}" required /><small>Для связи по заказу и доставке</small></label>
        <label className="field field--full"><span>Email *</span><input name="email" type="email" autoComplete="email" defaultValue={user.email} required /></label>
      </div>
      <fieldset className="checkout-delivery"><legend>Доставка · бесплатно</legend>{methods.map((method) => <label className="delivery-option" key={method.code}><input type="radio" name="delivery" value={method.code} checked={delivery === method.code} onChange={() => changeDelivery(method.code)} required /><span><strong>{method.name}</strong><small>{method.description}</small></span><strong>Бесплатно</strong></label>)}{ozonDelivery && <label className="delivery-option"><input type="radio" name="delivery" value="ozon-delivery" checked={isOzon} onChange={() => changeDelivery("ozon-delivery")} /><span><strong>Ozon Доставка</strong><small>В пункт выдачи или постамат · выбор ПВЗ на карте</small></span><strong>Бесплатно</strong></label>}</fieldset>
      {!ozonDelivery && <div className="delivery-option delivery-option--unavailable" aria-disabled="true"><span><strong>Ozon Доставка</strong><small>{ozonUnavailable ?? "Временно недоступна. Выберите другой способ доставки."}</small></span></div>}
      {isOzon && <><OzonDeliveryPicker phone={phone} onPhoneChange={changePhone} onQuote={setOzonQuote} packingReady={packingReady} /><input type="hidden" name="ozonQuote" value={ozonQuote?.token ?? ""} /></>}
      {delivery !== "pickup" && !isOzon && <div className="form-grid"><label className="field"><span>Город *</span><input name="city" autoComplete="address-level2" required minLength={2} maxLength={120} /></label><label className="field"><span>Индекс{delivery === "russian-post" ? " *" : ""}</span><input name="postalCode" autoComplete="postal-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required={delivery === "russian-post"} placeholder="6 цифр" /></label><label className="field field--full"><span>Улица, дом, квартира или пункт выдачи *</span><input name="address" autoComplete="street-address" required minLength={4} maxLength={300} /></label></div>}
      {delivery === "pickup" && <p className="notice">Место и время самовывоза согласуем при подтверждении заказа.</p>}
      <fieldset className="checkout-delivery"><legend>Оплата</legend>{onlinePayment && <label className="delivery-option"><input type="radio" name="payment" value="yookassa" checked={payment === "yookassa"} onChange={() => setPayment("yookassa")} /><span><strong>Карта или СБП</strong><small>Безопасная страница ЮKassa</small></span></label>}<label className="delivery-option"><input type="radio" name="payment" value="manual" checked={payment === "manual"} onChange={() => setPayment("manual")} /><span><strong>По счёту</strong><small>Реквизиты для оплаты после подтверждения заказа</small></span></label></fieldset>
      <label className="field"><span>Комментарий</span><textarea name="comment" maxLength={1000} placeholder="Пожелания к доставке или реквизиты для счёта" /></label>
      <p className="muted">Контактные данные и адрес нужны для заключения и исполнения вашего заказа. <Link className="text-link" href="/legal/privacy/" target="_blank">Как обрабатываются данные и кому передаются</Link>. Не указывайте в комментарии паспортные данные или реквизиты карты.</p>
      <label className="checkout-consent"><input type="checkbox" name="legal" required /><span>Принимаю <Link href="/legal/offer/" target="_blank">условия оферты</Link>. Это не согласие на рекламу или рассылки.</span></label>
    </div>
    <aside className="order-summary"><h2>Ваш заказ</h2><ul className="checkout-items">{items.map((item) => <li key={item.id}><strong>{item.name} × {item.quantity}</strong><small>{item.configuration}</small><span>{formatPrice(item.total)}</span></li>)}</ul><div className="summary-line"><span>Товары</span><strong>{formatPrice(subtotal)}</strong></div><div className="summary-line"><span>Доставка</span><strong>Бесплатно · 0 ₽</strong></div><div className="summary-line summary-line--total" aria-live="polite" aria-atomic="true"><span>Итого к оплате</span><strong>{formatPrice(total)}</strong></div><input type="hidden" name="expectedTotal" value={total.toFixed(2)} /><Submit total={total} online={payment === "yookassa"} needsQuote={isOzon && !ozonQuote} noDelivery={!methods.length && !ozonDelivery} /><p>Доставка за счёт магазина. Все выбранные параметры сохранятся в заказе.</p></aside>
  </form>;
}
