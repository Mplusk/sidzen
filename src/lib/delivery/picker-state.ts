import { isRussianMobilePhone } from "@/lib/checkout-validation";

export function deliveryCheckIssue(phone: string, point: string, consent: boolean, packingReady: boolean) {
  if (!packingReady) return "Для товара ещё не заполнены вес и размеры упаковки. Выберите другую доставку или обратитесь в магазин.";
  if (!isRussianMobilePhone(phone)) return "Укажите телефон получателя: российский мобильный номер в формате +7 (9XX) XXX-XX-XX. Затем проверьте доставку в Ozon.";
  if (!point) return "Выберите пункт выдачи на карте или в списке.";
  if (!consent) return "Отметьте отдельное согласие на передачу номера Ozon над кнопкой проверки.";
  return "";
}

export async function withDeliveryDeadline<T>(request: Promise<T>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([request, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Delivery check timed out")), 60000); })]); }
  finally { clearTimeout(timer); }
}
