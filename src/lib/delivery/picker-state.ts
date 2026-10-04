import { normalizePhone } from "@/lib/checkout-validation";

export function deliveryCheckIssue(phone: string, point: string, consent: boolean, packingReady: boolean) {
  if (!packingReady) return "Магазин должен указать вес и размеры упаковки товара. Пока выберите другой способ доставки.";
  if (!/^\+7\d{10}$/.test(normalizePhone(phone))) return "Заполните телефон получателя полностью в разделе «Контактные данные» выше. Нужен номер, зарегистрированный на Ozon.";
  if (!point) return "Выберите пункт выдачи на карте или в списке.";
  if (!consent) return "Подтвердите отдельное согласие на передачу номера Ozon — отметьте поле над кнопкой проверки.";
  return "";
}

export function approximatePosition(latitude: number, longitude: number) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw new Error("Invalid position");
  return { latitude: Math.round(latitude * 1000) / 1000, longitude: Math.round(longitude * 1000) / 1000 };
}

export function geolocationErrorMessage(code: number) {
  return code === 1 ? "Доступ к геопозиции запрещён. Разрешите его в настройках браузера для этого сайта или введите город вручную." : code === 3 ? "Не удалось определить местоположение за 12 секунд. Повторите попытку или введите город вручную." : "Геопозиция недоступна на этом устройстве. Введите город или улицу вручную.";
}

export function locateDevice(geolocation: Pick<Geolocation, "getCurrentPosition">, signal: AbortSignal) {
  return new Promise<{ latitude: number; longitude: number }>((resolve, reject) => {
    const finish = (action: () => void) => { clearTimeout(timer); signal.removeEventListener("abort", cancel); action(); };
    const cancel = () => finish(() => reject(new DOMException("Canceled", "AbortError")));
    // The browser's own timeout need not include time spent awaiting permission.
    const timer = setTimeout(() => finish(() => reject({ code: 3 })), 16000);
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) { cancel(); return; }
    geolocation.getCurrentPosition(position => finish(() => {
      try { resolve(approximatePosition(position.coords.latitude, position.coords.longitude)); } catch (error) { reject(error); }
    }), error => finish(() => reject(error)), { enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 });
  });
}

export async function withDeliveryDeadline<T>(request: Promise<T>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([request, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Delivery check timed out")), 60000); })]); }
  finally { clearTimeout(timer); }
}
