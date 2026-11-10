import { createHash } from "node:crypto";
export const adminConfirmScript = `const token = location.hash.slice(1); history.replaceState(null, "", location.pathname + location.search);
if (/^[A-Za-z0-9_-]{43}$/.test(token)) { const enroll = location.search === "?enroll=1"; document.getElementById("token").value = token; document.getElementById("intent").value = enroll ? "enroll" : "login"; document.getElementById("submit").disabled = false; document.getElementById("help").textContent = enroll ? "Нажимая кнопку, вы включаете подтверждение входа по почте для управления магазином." : "Подтвердите вход в кабинет управления."; }`;
export const adminConfirmCsp = `default-src 'none'; script-src 'sha256-${createHash("sha256").update(adminConfirmScript).digest("base64")}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`;

