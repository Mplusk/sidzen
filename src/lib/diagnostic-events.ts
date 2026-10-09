// Closed vocabulary: never render raw errors, provider responses or request inputs.
export const logAreas = { ai: "DeepSeek · категории", delivery: "Ozon Доставка", checkout: "Оформление заказа", payment: "Точка · оплата", fiscal: "CloudKassir · чеки", social: "Вход через соцсети", marketplace: "Импорт товаров", worker: "Фоновые задачи", server: "Сайт · серверные ошибки" } as const;
export const logLevels = { INFO: "Событие", WARN: "Предупреждение", ERROR: "Ошибка" } as const;
export const diagnosticEvents = {
  "review-ai.approved": ["ai", "INFO", "DeepSeek подтвердил публикацию отзыва"],
  "review-ai.manual": ["ai", "WARN", "Отзыв направлен на ручную проверку"],
  "telegram.sent": ["worker", "INFO", "Уведомление о новом заказе отправлено в Telegram"],
  "telegram.failed": ["worker", "WARN", "Не удалось подтвердить отправку уведомления Telegram; проверьте подключение"],
  "communications.failed": ["worker", "WARN", "Ошибка фоновой проверки отзывов или уведомлений; задачи сохранены"],
  "category-ai.ok": ["ai", "INFO", "DeepSeek определил категорию товара"],
  "category-ai.failed": ["ai", "WARN", "Не удалось определить категорию DeepSeek; товар сохранён"],
  "delivery.quote.ok": ["delivery", "INFO", "Доставка в ПВЗ проверена"],
  "delivery.quote.expired": ["delivery", "WARN", "Истёк срок расчёта доставки (15 минут)"],
  "delivery.quote.signature": ["delivery", "WARN", "Расчёт отсутствует, повреждён или имеет неверную подпись"],
  "delivery.quote.cart": ["delivery", "WARN", "После расчёта изменились корзина, цена или упаковка товара"],
  "delivery.quote.config": ["delivery", "WARN", "После расчёта изменились настройки доставки"],
  "delivery.quote.phone": ["delivery", "WARN", "Телефон заказа не совпадает с телефоном расчёта"],
  "delivery.consent": ["delivery", "WARN", "Отсутствует действующее отдельное согласие на передачу номера Ozon"],
  "delivery.operator": ["delivery", "WARN", "Не подтверждены реквизиты оператора или размещение данных в РФ"],
  "delivery.disabled": ["delivery", "WARN", "Подключение Ozon выключено или не заполнено"],
  "delivery.credentials": ["delivery", "ERROR", "Ozon отклонил авторизацию подключения"],
  "delivery.transport": ["delivery", "ERROR", "Сетевая ошибка или таймаут при обращении к Ozon"],
  "delivery.rate": ["delivery", "WARN", "Превышен лимит запросов доставки"],
  "delivery.recipient": ["delivery", "WARN", "Ozon не подтвердил возможность доставки получателю"],
  "delivery.packaging": ["delivery", "WARN", "Вес или габариты упаковки товара не заполнены или некорректны"],
  "delivery.point": ["delivery", "WARN", "Выбранный ПВЗ не найден или неактивен"],
  "delivery.cart": ["delivery", "WARN", "Корзина пуста или содержит недоступные товары"],
  "delivery.parcels": ["delivery", "WARN", "Некорректное количество посылок (допустимо 1–100)"],
  "delivery.unavailable": ["delivery", "WARN", "Ozon не подтвердил доставку всех посылок в выбранный ПВЗ"],
  "delivery.response": ["delivery", "ERROR", "Ответ Ozon не соответствует ожидаемому формату"],
  "delivery.provider": ["delivery", "ERROR", "Ozon вернул ошибку при проверке доставки"],
  "delivery.price": ["delivery", "WARN", "При повторной проверке изменились расходы магазина на доставку"],
  "delivery.recheck.ok": ["delivery", "INFO", "Повторная проверка доставки перед заказом пройдена"],
  "delivery.points.failed": ["delivery", "ERROR", "Не удалось обновить справочник ПВЗ"],
  "delivery.shipment.failed": ["delivery", "ERROR", "Не удалось создать отправление Ozon; задача сохранена для повторной проверки"],
  "delivery.status.failed": ["delivery", "ERROR", "Не удалось обновить статус отправления Ozon"],
  "checkout.invalid": ["checkout", "WARN", "Данные оформления заказа не прошли проверку"],
  "checkout.price": ["checkout", "WARN", "Изменилась итоговая сумма заказа"],
  "checkout.changed": ["checkout", "WARN", "Заказ не создан: корзина или настройки изменились либо возникла ошибка сохранения"],
  "checkout.created": ["checkout", "INFO", "Заказ сохранён"],
  "checkout.application": ["checkout", "INFO", "Заявка передана продавцу без оплаты"],
  "delivery.cancel.ok": ["delivery", "INFO", "Ozon подтвердил отмену отправлений удалённой заявки"],
  "delivery.cancel.pending": ["delivery", "WARN", "Отмена отправлений Ozon запрошена, ожидается подтверждение"],
  "delivery.cancel.failed": ["delivery", "ERROR", "Ozon не подтвердил отмену отправлений; задача сохранена для повтора"],
  "payment.create.failed": ["payment", "ERROR", "Не удалось получить платёжную ссылку Точки; заказ сохранён"],
  "payment.reconcile.failed": ["payment", "ERROR", "Не удалось сверить платёж с Точкой; проверка будет повторена"],
  "fiscal.failed": ["fiscal", "ERROR", "Ошибка отправки или сверки чека CloudKassir"],
  "fiscal.review": ["fiscal", "WARN", "CloudKassir требует ручной проверки чека"],
  "social.ok": ["social", "INFO", "Ответ провайдера входа успешно обработан"],
  "social.failed": ["social", "WARN", "Не удалось завершить вход через социальный сервис"],
  "social.canceled": ["social", "INFO", "Пользователь отменил вход у провайдера"],
  "worker.failed": ["worker", "ERROR", "Ошибка фонового обработчика; задачи сохранены для повторной обработки"],
  "worker.cache": ["worker", "WARN", "Не удалось немедленно обновить кеш каталога после импорта"],
  "marketplace.ok": ["marketplace", "INFO", "Импорт товаров завершён"],
  "marketplace.failed": ["marketplace", "ERROR", "Импорт товаров завершился ошибкой; обработанные товары сохранены"],
  "marketplace.images": ["marketplace", "WARN", "Не удалось загрузить изображения импортируемого товара"],
  "server.failed": ["server", "ERROR", "Необработанная серверная ошибка сайта"],
} as const;
export type DiagnosticCode = keyof typeof diagnosticEvents;
export const categoryAiFailureLabels = {
  credentials: "DeepSeek отклонил ключ API", rate: "DeepSeek ограничил запросы",
  transport: "Сетевая ошибка или таймаут DeepSeek", provider: "DeepSeek отклонил запрос",
  response: "Некорректный ответ DeepSeek", catalog: "Каталог содержит более 500 категорий",
  "no-category": "Подходящая доступная категория не найдена",
} as const;
export const checkoutFailureLabels = {
  "empty-results": "Ozon вернул пустой результат расчёта",
  "partial-results": "Ozon вернул расчёт только части посылок",
  "duplicate-results": "В ответе Ozon повторяются номера посылок",
  "unexpected-request-id": "Ozon вернул результат для другой посылки",
  "missing-posting": "Ozon не вернул тариф для посылки",
  "point-restrictions": "Ozon сообщил об ограничениях выбранного ПВЗ для посылки",
  "provider-rejection": "Ozon явно отклонил расчёт; причина не распознана интеграцией",
} as const;
export type DiagnosticDetails = { durationMs?: number; carrierCostKopecks?: number; expectedCarrierCostKopecks?: number; attempts?: number; pointId?: number; expectedParcels?: number; receivedParcels?: number; checkoutFailure?: string; aiFailure?: string; provider?: "vk" | "google" | "yandex" | "ozon" | "wb"; stage?: "quote" | "verify" | "consent" | "recheck" | "shipment" | "status" | "points" | "cancel"; reason?: string };
const safeReasons = ["expired", "signature", "cart", "config", "phone", "credentials", "transport", "rate", "recipient", "packaging", "point", "parcels", "unavailable", "response", "provider", "disabled", "method", "pagination", "unpaid", "cancel-review", "partial", "redirect", "social-expired", "social-canceled", "social-operator", "social-conflict", "social-link-session", "social-disabled", "social-failed", "provider-rejected", "temporary", "uncertain-submission", "provider-status", "already-delivered", "cancel-pending"];
export function safeDiagnosticDetails(input: DiagnosticDetails = {}): Record<string, string | number> {
  const result: Record<string, string | number> = {};
  for (const key of ["durationMs", "carrierCostKopecks", "expectedCarrierCostKopecks", "attempts", "pointId", "expectedParcels", "receivedParcels"] as const) {
    const value = input[key];
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000) result[key] = value;
  }
  if (["vk", "google", "yandex", "ozon", "wb"].includes(input.provider ?? "")) result.provider = input.provider!;
  if (["quote", "verify", "consent", "recheck", "shipment", "status", "points", "cancel"].includes(input.stage ?? "")) result.stage = input.stage!;
  if (safeReasons.includes(input.reason ?? "")) result.reason = input.reason!;
  if (input.checkoutFailure && Object.hasOwn(checkoutFailureLabels, input.checkoutFailure)) result.checkoutFailure = input.checkoutFailure;
  if (input.aiFailure && Object.hasOwn(categoryAiFailureLabels, input.aiFailure)) result.aiFailure = input.aiFailure;
  return result;
}
export function ozonDiagnosticCode(reason: string): DiagnosticCode {
  const codes: Record<string, DiagnosticCode> = { credentials: "delivery.credentials", transport: "delivery.transport", rate: "delivery.rate", recipient: "delivery.recipient", packaging: "delivery.packaging", point: "delivery.point", cart: "delivery.cart", parcels: "delivery.parcels", unavailable: "delivery.unavailable", response: "delivery.response", disabled: "delivery.disabled" };
  return Object.hasOwn(codes, reason) ? codes[reason] : "delivery.provider";
}
