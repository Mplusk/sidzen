"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useRef, useState, useTransition } from "react";
import { createOrderWithState } from "@/app/actions/checkout";
import { updateCheckoutCartItem } from "@/app/actions/checkout-cart";
import type { CheckoutActionState } from "@/lib/checkout-action-state";
import { formatPrice } from "@/lib/format";
import { phoneMask } from "@/lib/phone-input";
import { OzonDeliveryPicker, type DeliveryQuoteView } from "@/components/ozon-delivery-picker";
import { CdekDeliveryPicker, type CdekQuoteView } from "@/components/cdek-delivery-picker";
import { customerDeliveryPrice } from "@/lib/delivery/pricing";
import { ValidatedInput } from "@/components/validated-input";
import styles from "./checkout-form.module.css";

type Delivery = { code: string; name: string; description: string | null; basePrice: number };
const deliveryErrors: Record<string, string> = {
  "temporary": "Не удалось отправить заявку из-за временного сбоя. Повторите попытку; поля формы сохранены.",
  "operator": "Магазин временно не может принять заявку. Свяжитесь с продавцом; введённые данные сохранены в этой форме.",
  "delivery": "Выбранный способ доставки больше недоступен. Выберите другой; контактные данные сохранены.",
  "changed": "Корзина или условия заказа изменились. Проверьте корзину перед повторной отправкой.",
  "ozon": "Не удалось подтвердить доставку. Проверьте ПВЗ и повторите расчёт.",
  "ozon-expired": "Истекли 15 минут действия расчёта. Проверьте доставку в ПВЗ заново.",
  "ozon-cart": "Изменились товары, цена или упаковка. Проверьте корзину и рассчитайте доставку заново.",
  "ozon-config": "Магазин обновил настройки доставки. Проверьте ПВЗ заново.",
  "ozon-phone": "Изменился телефон получателя. Проверьте доставку с текущим номером заново.",
  "ozon-signature": "Расчёт доставки отсутствует или повреждён. Проверьте ПВЗ заново.",
  "ozon-consent": "Согласие на проверку Ozon отсутствует, отозвано или устарело. Подтвердите его и повторите расчёт.",
  "ozon-transport": "Ozon не ответил на повторную проверку. Повторите расчёт чуть позже.",
  "ozon-provider": "Ozon вернул ошибку при повторной проверке доставки. Повторите расчёт или обратитесь в магазин.",
  "ozon-recipient": "Ozon не подтвердил доставку для этого номера. Проверьте его или укажите другой номер, зарегистрированный в Ozon.",
  "ozon-unavailable": "Ozon не подтвердил доставку всех товаров в этот ПВЗ. Попробуйте другой пункт.",
  "ozon-price": "Ozon изменил расходы магазина на перевозку. Проверьте доставку заново; для вас она остаётся бесплатной.",
  "ozon-disabled": "Доставка Ozon временно выключена магазином. Повторите позже.",
  "ozon-credentials": "Ozon отклонил подключение магазина. Сообщите об этом продавцу.",
  "ozon-rate": "Ozon ограничил частоту проверок. Повторите чуть позже.",
  "cdek": "СДЭК не подтвердил доставку или стоимость изменилась. Выберите ПВЗ и тариф заново.",
  "payment-items": "Не удалось подготовить состав чека. Проверьте корзину или обратитесь в магазин.",
  "payment-changed": "Условия оплаты изменились. Обновите страницу и проверьте заказ.",
};
function Submit({ needsQuote, noDelivery, pending, cartPending, onlinePayment }: { needsQuote: boolean; noDelivery: boolean; pending: boolean; cartPending: boolean; onlinePayment: boolean }) {
  return <button className={`button ${styles.submit}`} type="submit" disabled={pending || cartPending || needsQuote || noDelivery} aria-busy={pending || cartPending}>{pending ? "Оформляем…" : cartPending ? "Обновляем корзину…" : noDelivery ? "Доставка временно недоступна" : needsQuote ? "Сначала подтвердите пункт выдачи" : onlinePayment ? "Перейти к оплате" : "Отправить заявку"}</button>;
}

export function CheckoutForm({ items, methods, user, error, reference, ozonDelivery = false, cdekDelivery = false, packingReady = true, onlinePayment = false }: {
  items: Array<{ id: string; name: string; sku?: string; image?: string | null; configuration: string; quantity: number; total: number }>;
  methods: Delivery[]; user: { name: string; email: string; phone: string }; error?: string; reference?: string;
  ozonDelivery?: boolean;
  cdekDelivery?: boolean;
  packingReady?: boolean;
  onlinePayment?: boolean;
}) {
  const router = useRouter();
  const phoneInput = useRef<HTMLInputElement>(null);
  const editPhone = () => { phoneInput.current?.focus({ preventScroll: true }); phoneInput.current?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" }); };
  const [cartPending, updateCart] = useTransition();
  const [cartError, setCartError] = useState("");
  const [quoteRevision, setQuoteRevision] = useState(0);
  const [ozonQuoteEntry, setOzonQuoteEntry] = useState<{ revision: number; value: DeliveryQuoteView | null }>({ revision: 0, value: null });
  const ozonQuote = ozonQuoteEntry.revision === quoteRevision ? ozonQuoteEntry.value : null;
  const setOzonQuote = (value: DeliveryQuoteView | null) => setOzonQuoteEntry(previous => previous.revision > quoteRevision ? previous : { revision: quoteRevision, value });
  const [cdekQuote, setCdekQuote] = useState<CdekQuoteView | null>(null);
  const [cdekRevision, setCdekRevision] = useState(0);
  const [state, formAction, pending] = useActionState(createOrderWithState, {} as CheckoutActionState);
  const [dismissedRecipientError, setDismissedRecipientError] = useState<CheckoutActionState | null>(null);
  const [lastActionState, setLastActionState] = useState(state);
  if (lastActionState !== state) {
    setLastActionState(state);
    if (state.error && /^ozon-(expired|cart|config|phone|signature|consent|unavailable|price|recipient)$/.test(state.error)) {
      setOzonQuote(null); setQuoteRevision(value => value + 1);
    }
    if (state.error === "cdek") { setCdekQuote(null); setCdekRevision(value => value + 1); }
  }
  const [contact, setContact] = useState({ name: user.name, email: user.email, city: "", address: "", postalCode: "", comment: "", legal: false });
  const update = (key: "name" | "email" | "city" | "address" | "postalCode" | "comment", value: string) => setContact(previous => ({ ...previous, [key]: value }));
  const currentError = dismissedRecipientError === state ? undefined : state.error ?? error, currentReference = state.reference ?? reference;
  const [delivery, setDelivery] = useState(ozonDelivery ? "ozon-delivery" : cdekDelivery ? "cdek-delivery" : methods[0]?.code ?? "");
  const [phone, setPhone] = useState(phoneMask(user.phone));
  const changePhone = (value: string) => { const next = phoneMask(value); setPhone(next); if (next !== phone) { if (currentError === "ozon-recipient") setDismissedRecipientError(state); setOzonQuote(null); setQuoteRevision(value => value + 1); } };
  const changeDelivery = (code: string) => { setDelivery(code); setOzonQuote(null); setQuoteRevision(value => value + 1); setCdekQuote(null); };
  const changeQuantity = (id: string, current: number, next: number) => {
    if (pending || cartPending) return;
    setCartError(""); setOzonQuote(null); setCdekQuote(null); setQuoteRevision(value => value + 1); setCdekRevision(value => value + 1);
    updateCart(async () => {
      try {
        const result = await updateCheckoutCartItem(id, current, next);
        if (result.error) setCartError(result.error);
        router.refresh();
      } catch { setCartError("Не удалось обновить корзину. Повторите попытку."); }
    });
  };
  const subtotal = items.reduce((sum, item) => sum + item.total, 0);
  const isOzon = delivery === "ozon-delivery";
  const isCdek = delivery === "cdek-delivery";
  const deliveryPrice = isCdek ? cdekQuote?.cost ?? 0 : customerDeliveryPrice();
  const total = subtotal + deliveryPrice;
  // Dispatch explicitly so expected server errors leave entered fields intact.
  return <form action={formAction} onSubmit={event => { event.preventDefault(); if (pending || cartPending) return; const data = new FormData(event.currentTarget); startTransition(() => formAction(data)); }} className={`checkout-form ${styles.layout}`}>
    <div className={styles.main}>
      {currentError && <div className="notice notice--danger" role="alert" tabIndex={-1}><p>{deliveryErrors[currentError] ?? (currentError === "price" ? "Цена или условия доставки изменились. Проверьте обновлённую сумму и отправьте заявку заново." : "Проверьте контактные данные, адрес и согласие с условиями.")}</p>{currentError === "ozon-recipient" && <button type="button" className="text-link" onClick={editPhone}>Изменить телефон получателя</button>}{state.fields && <ul>{Object.entries(state.fields).map(([key, messages]) => <li key={key}>{({ name: "ФИО", email: "Email", phone: "Телефон", address: "Адрес", legal: "Согласие", ozonQuote: "Пункт выдачи" } as Record<string, string>)[key] ?? key}: {messages.join(". ")}</li>)}</ul>}{currentReference && /^[a-f0-9-]{36}$/i.test(currentReference) && <small>Код обращения: {currentReference}</small>}<p>Введённые данные остались в форме.</p></div>}
      <input type="hidden" name="paymentMode" value={onlinePayment ? "online" : "application"} />

      <section className={styles.panel} aria-labelledby="checkout-products">
        <div className={styles.panelHeading}><div><h2 id="checkout-products">Ваш заказ</h2><p>Проверьте состав и количество</p></div><Link className="text-link" href="/cart/">Изменить корзину</Link></div>
        {cartError && <p className="notice notice--danger" role="alert">{cartError}</p>}
        <ul className={styles.items} aria-busy={cartPending}>{items.map(item => <li className={styles.item} key={item.id}>
          {item.image ? <Image className={styles.itemImage} src={item.image} alt="" width={76} height={76} /> : <div className={styles.itemPlaceholder} aria-hidden="true" />}
          <div className={styles.itemInfo}><strong>{item.name}</strong>{item.sku && <small>Арт. {item.sku}</small>}{item.configuration && <small>{item.configuration}</small>}<small>{formatPrice(item.total / item.quantity)} за шт.</small></div>
          <div className={styles.itemActions}><div className={styles.quantity} aria-label={`Количество: ${item.name}`}><button type="button" aria-label={`Уменьшить количество: ${item.name}`} disabled={cartPending || pending || item.quantity <= 1} onClick={() => changeQuantity(item.id, item.quantity, item.quantity - 1)}>−</button><span aria-live="polite">{item.quantity}</span><button type="button" aria-label={`Увеличить количество: ${item.name}`} disabled={cartPending || pending || item.quantity >= 999} onClick={() => changeQuantity(item.id, item.quantity, item.quantity + 1)}>+</button></div><strong className={styles.itemTotal}>{formatPrice(item.total)}</strong><button type="button" className={styles.remove} aria-label={`Удалить из заказа: ${item.name}`} disabled={cartPending || pending} onClick={() => changeQuantity(item.id, item.quantity, 0)}><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" /></svg></button></div>
        </li>)}</ul>
      </section>

      <section className={styles.panel} aria-labelledby="checkout-recipient">
        <div className={styles.panelHeading}><div><h2 id="checkout-recipient">Получатель</h2><p>Контакты для связи и доставки</p></div></div>
        <div className={styles.contacts}>
          <label className="field"><span>Имя и фамилия *</span><ValidatedInput aria-label="ФИО получателя" name="name" autoComplete="name" value={contact.name} onChange={event => update("name", event.target.value)} required minLength={2} maxLength={120} /></label>
          <label className="field"><span>Телефон *</span><ValidatedInput ref={phoneInput} aria-label="Телефон" name="phone" type="tel" autoComplete="tel" inputMode="tel" value={phone} onChange={event => changePhone(event.target.value)} placeholder="+7 (999) 123-45-67" pattern={isOzon ? String.raw`\+7 \(9[0-9]{2}\) [0-9]{3}-[0-9]{2}-[0-9]{2}` : String.raw`\+7 \([0-9]{3}\) [0-9]{3}-[0-9]{2}-[0-9]{2}`} patternMessage={isOzon ? "Для Ozon укажите российский мобильный номер: +7 (9XX) XXX-XX-XX." : undefined} required /></label>
          <label className="field"><span>Электронная почта *</span><ValidatedInput aria-label="Email" name="email" type="email" autoComplete="email" value={contact.email} onChange={event => update("email", event.target.value)} required /></label>
        </div>
        <p className={styles.hint}>Регистрация не обязательна. На почту придёт информация о {onlinePayment ? "заказе и чек" : "заявке"}.</p>
      </section>

      <section className={styles.panel} aria-labelledby="checkout-delivery">
        <div className={styles.panelHeading}><div><h2 id="checkout-delivery">Доставка</h2><p>Выберите способ получения</p></div></div>
        <fieldset className={styles.methods}><legend className="visually-hidden">Способ доставки</legend>
          {ozonDelivery && <label className={styles.method}><input type="radio" name="delivery" value="ozon-delivery" checked={isOzon} onChange={() => changeDelivery("ozon-delivery")} required /><span className={styles.carrierLogo}><Image src="/brand/ozon-delivery.svg" alt="" width={83} height={20} /></span><span className={styles.methodText}><strong>Ozon Доставка</strong><small>{ozonQuote ? `Примерно ${ozonQuote.days} дн. после отгрузки` : "Пункт выдачи или постамат"}</small></span><strong className={styles.methodPrice}>Бесплатно</strong></label>}
          {cdekDelivery && <label className={styles.method}><input type="radio" name="delivery" value="cdek-delivery" checked={isCdek} onChange={() => changeDelivery("cdek-delivery")} required /><span className={styles.carrierLogo}><Image src="/brand/cdek.svg" alt="" width={83} height={24} /></span><span className={styles.methodText}><strong>СДЭК</strong><small>{cdekQuote ? `${cdekQuote.daysMin}–${cdekQuote.daysMax} дн. после отгрузки` : "Доставка в пункт выдачи"}</small></span><strong className={styles.methodPrice}>{cdekQuote ? formatPrice(cdekQuote.cost) : "По тарифу"}</strong></label>}
          {methods.map(method => <label className={styles.method} key={method.code}><input type="radio" name="delivery" value={method.code} checked={delivery === method.code} onChange={() => changeDelivery(method.code)} required /><span className={styles.methodIcon} aria-hidden="true">{method.code === "pickup" ? <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 10v10h16V10M3 10l2-6h14l2 6M3 10c0 2 3 2 4 0 1 2 3 2 5 0 1 2 4 2 5 0 1 2 4 2 4 0M9 20v-6h6v6" /></svg> : <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 5h11v11H3zM14 9h4l3 3v4h-7M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm11 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" /></svg>}</span><span className={styles.methodText}><strong>{method.name}</strong>{method.description && <small>{method.description}</small>}</span><strong className={styles.methodPrice}>Бесплатно</strong></label>)}
        </fieldset>
        {isOzon && <><OzonDeliveryPicker phone={phone} onEditPhone={editPhone} onQuote={setOzonQuote} packingReady={packingReady} verificationRevision={quoteRevision} /><input type="hidden" name="ozonQuote" value={ozonQuote?.token ?? ""} /></>}
        {isCdek && <><CdekDeliveryPicker key={cdekRevision} onQuote={setCdekQuote} /><input type="hidden" name="cdekQuote" value={cdekQuote?.token ?? ""} /></>}
        {delivery && delivery !== "pickup" && !isOzon && !isCdek && <div className="form-grid"><label className="field"><span>Город *</span><input name="city" autoComplete="address-level2" value={contact.city} onChange={event => update("city", event.target.value)} required minLength={2} maxLength={120} /></label><label className="field"><span>Индекс{delivery === "russian-post" ? " *" : ""}</span><input name="postalCode" autoComplete="postal-code" value={contact.postalCode} onChange={event => update("postalCode", event.target.value)} inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required={delivery === "russian-post"} placeholder="6 цифр" /></label><label className="field field--full"><span>Улица, дом, квартира или пункт выдачи *</span><input name="address" autoComplete="street-address" value={contact.address} onChange={event => update("address", event.target.value)} required minLength={4} maxLength={300} /></label></div>}
        {delivery === "pickup" && <p className={styles.hint}>Место и время самовывоза согласуем при подтверждении заказа.</p>}
        <details className={styles.comment}><summary>Добавить комментарий к заказу</summary><label className="field"><span>Комментарий</span><textarea name="comment" value={contact.comment} onChange={event => update("comment", event.target.value)} maxLength={1000} placeholder="Пожелания к заказу и удобное время для связи" /></label><small>Не указывайте паспортные данные или реквизиты карты.</small></details>
      </section>
    </div>

    <aside className={styles.sidebar} aria-labelledby="checkout-total">
      <div className={styles.summary}><p className={styles.summaryKicker}>{onlinePayment ? "К оплате" : "Итого по заявке"}</p><div className={styles.total}><h2 id="checkout-total">{onlinePayment ? "Ваш заказ" : "Ваша заявка"}</h2><strong aria-live="polite" aria-atomic="true">{formatPrice(total)}</strong></div>
        <div className={styles.summaryLine}><span>Товары</span><strong>{formatPrice(subtotal)}</strong></div><div className={styles.summaryLine}><span>Доставка</span><strong>{!delivery ? "Недоступна" : isCdek ? cdekQuote ? formatPrice(deliveryPrice) : "Выберите пункт" : "Бесплатно · 0 ₽"}</strong></div>
        <input type="hidden" name="expectedTotal" value={total.toFixed(2)} />
        <label className="checkout-consent"><input type="checkbox" name="legal" checked={contact.legal} onChange={event => setContact(previous => ({ ...previous, legal: event.target.checked }))} required /><span>Принимаю <Link href="/legal/offer/" target="_blank">условия оформления {onlinePayment ? "заказа" : "заявки"}</Link>. Это не согласие на рекламу или рассылки.</span></label>
        <Submit onlinePayment={onlinePayment} pending={pending} cartPending={cartPending} needsQuote={(isOzon && !ozonQuote) || (isCdek && !cdekQuote)} noDelivery={!methods.length && !ozonDelivery && !cdekDelivery} />
        <p className={styles.summaryNote}>{onlinePayment ? "Оплата и электронный чек — через ЮKassa." : "Оплата на сайте не требуется. Продавец свяжется с вами для подтверждения."}</p>
        <p className={styles.summaryNote}>Контакты и адрес нужны для обработки заказа и связи. Данные получателя и параметры отправления передаются выбранному перевозчику. <Link className="text-link" href="/legal/privacy/" target="_blank">Обработка данных</Link></p>
      </div>
    </aside>
  </form>;
}
