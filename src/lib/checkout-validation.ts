import { z } from "zod";

export function normalizePhone(value: string) {
  let digits = value.replace(/\D/g, "");
  if (digits.length === 11 && digits[0] === "8") digits = `7${digits.slice(1)}`;
  return digits ? `+${digits}` : "";
}

export const checkoutSchema = z.object({
  name: z.string().trim().min(2).max(120), email: z.email().transform((value) => value.toLowerCase()),
  phone: z.string().transform(normalizePhone).refine((value) => /^\+7\d{10}$/.test(value), "Укажите российский номер телефона"),
  city: z.string().trim().max(120), address: z.string().trim().max(300), postalCode: z.string().trim().max(6),
  delivery: z.string().min(1).max(80), comment: z.string().trim().max(1000), legal: z.literal("on"),
  expectedTotal: z.coerce.number().positive().finite(),
  ozonQuote: z.string().max(100000).optional().default(""),
  ozonConsent: z.string().optional().default(""),
}).superRefine((data, context) => {
  if (!["pickup", "ozon-delivery"].includes(data.delivery) && (data.city.length < 2 || data.address.length < 4)) context.addIssue({ code: "custom", path: ["address"], message: "Заполните адрес доставки" });
  if (data.delivery === "ozon-delivery" && !data.ozonQuote) context.addIssue({ code: "custom", path: ["ozonQuote"], message: "Рассчитайте доставку до ПВЗ" });
  if (data.delivery === "ozon-delivery" && data.ozonConsent !== "on") context.addIssue({ code: "custom", path: ["ozonConsent"], message: "Подтвердите передачу номера для расчёта Ozon" });
  if ((data.postalCode && !/^\d{6}$/.test(data.postalCode)) || (data.delivery === "russian-post" && !/^\d{6}$/.test(data.postalCode))) context.addIssue({ code: "custom", path: ["postalCode"], message: "Индекс должен содержать 6 цифр" });
});
