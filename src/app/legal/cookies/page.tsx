import type { Metadata } from "next";

export const metadata: Metadata = { title: "Использование cookies" };
export default function CookiesPage() { return <article className="container prose-page"><span className="eyebrow">Cookies</span><h1>Использование cookies</h1><p>Необходимые cookies поддерживают авторизацию, корзину и безопасный доступ к загруженной модели. Без них магазин не сможет оформить заказ.</p><h2>Аналитика</h2><p>Яндекс Метрика и Google Analytics подключаются через настройки кабинета и включаются только после согласия пользователя. Рекламные cookies по умолчанию отключены.</p><h2>Управление</h2><p>Вы можете удалить cookies в настройках браузера. Это завершит сессию и очистит гостевую корзину.</p></article>; }
