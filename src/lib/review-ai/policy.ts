export const REVIEW_AI_CONSENT_VERSION = "2026-10-09-review-ai-v1";
export const REVIEW_AI_CONSENT_TEXT = "Отдельно разрешаю передать текст моего отзыва и оценку внешнему сервису DeepSeek (deepseek.com, DeepSeek, Китай) для автоматической проверки соответствия товару, спама и запрещённого содержания. Передача может быть трансграничной. Публичное имя, данные профиля и заказа, фотографии, телефон, email и адрес не передаются. Не указываю персональные или конфиденциальные данные в тексте. Согласие добровольное: без него отзыв проверяет администратор, возможность публикации и оценка не меняются. Согласие действует до завершения проверки или отзыва через раздел «Персональные данные» / удаление отзыва. Автоматическое решение можно оспорить, связавшись с магазином.";
export const reviewAiReasons: Record<string, string> = {
  approved: "DeepSeek: содержание соответствует правилам",
  queued: "Ожидает проверки DeepSeek", processing: "DeepSeek проверяет текст",
  links: "Ссылки или контакты в тексте", instructions: "Возможные скрытые инструкции для ИИ",
  profanity: "Возможная ненормативная лексика", politics: "Политические высказывания",
  unrelated: "Отзыв может не соответствовать товару", uncertain: "ИИ не уверен в результате",
  personal: "Возможные персональные данные", photos: "Фотографии требуют проверки человеком",
  consent: "Нет отдельного действующего согласия на проверку DeepSeek",
  disabled: "Автоматическая проверка не настроена / выключена",
  unavailable: "DeepSeek недоступен после повторов", response: "Не удалось безопасно разобрать ответ ИИ",
  changed: "Данные или решение изменились во время проверки", manual: "Решение администратора",
};
// Reject before paying for a completion. Normalize invisible/control text;
// neither original text nor a suspected prompt is ever executed as instructions.
export function reviewTextGate(text: string): string | null {
  const value = text.normalize("NFKC").toLocaleLowerCase("ru");
  const compact = value.replace(/[\p{Cf}\p{Cc}\s]/gu, "");
  if (/[\p{Cf}]/u.test(text) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(text)) return "instructions";
  if (/(?:https?:|ftp:|www\.|tg:|t\.me|mailto:|[\p{L}\d-]+\.(?:ru|com|net|org|shop|рф|io|me|xyz)(?:\/|$|[^\p{L}]))/iu.test(compact) || /[\p{L}\d-]+\.[\p{L}]{2,24}\//iu.test(compact) || /[\p{L}\d-]+\.[a-z]{2,24}(?:\b|\/)/iu.test(value)) return "links";
  if (/(?:^|[^\p{L}])(?:бля\p{L}*|[её]б(?:а|у|н)\p{L}*|хуй\p{L}*|пизд\p{L}*|fuck\p{L}*|shit)(?:$|[^\p{L}])/iu.test(value)) return "profanity";
  if (/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(value) || /(?:\+?\d[\s().-]*){10,}/.test(value)) return "personal";
  if (/(?:ignore|disregard|forget|override).{0,60}(?:instructions|prompt|system)|(?:игнорируй|забудь|переопредели|не выполняй).{0,60}(?:инструкц|правил|промпт)|(?:system|assistant|developer)\s*:|<\/?(?:system|assistant|script)|\[inst\]|(?:выполни|execute).{0,30}(?:запрос|код|команд)|(?:напиши|write|сгенерируй|generate).{0,30}(?:код|code|essay|сочинение|стих)|(?:base64|jailbreak|prompt.?injection)|"(?:approve|safe|relevant)"\s*:/iu.test(value)) return "instructions";
  return null;
}
