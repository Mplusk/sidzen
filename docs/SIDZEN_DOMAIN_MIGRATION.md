# SIDZEN: один домен

Все действующие URL магазина используют `https://sidzen.shop`: canonical, sitemap,
robots, JSON-LD, OAuth, уведомления, карта, место расчётов и подсказки вебхуков.
`www.sidzen.shop` перенаправляется на основной домен. Прежний сайт не обслуживается.

После развёртывания обновить настройки в кабинетах внешних сервисов:

- VK ID: доверенный домен `sidzen.shop`, Redirect URI
  `https://sidzen.shop/api/auth/social/vk/callback/`.
- Яндекс: `https://sidzen.shop/api/auth/social/yandex/callback/`.
- Google: origin `https://sidzen.shop`, Redirect URI
  `https://sidzen.shop/api/auth/social/google/callback/` (отдельные правовые условия включения сохраняются).
- Точка, если используется сверка прежних платежей: уведомления
  `https://sidzen.shop/api/payments/tochka/`.
- CloudKassir, если подключается: зарегистрированное место расчётов `sidzen.shop`,
  Receipt webhook `https://sidzen.shop/api/fiscal/cloudkassir/`.

Изменение кода не меняет регистрацию приложения или фискализацию кассы у провайдера.
Новые заявки по-прежнему не создают оплату или чек. История платёжных документов,
согласий и идентичности пользователей не переписывается. Существующий логин владельца
сохраняется; новые установленные магазины используют шаблон SIDZEN.

На VPS обновляются публичный URL env, настройка `site.domain`, Nginx и Caddy.
Docker project, пути и volumes остаются прежними: это внутренние идентификаторы,
не домены. Их смена может подключить пустую базу вместо действующего магазина.

Проверка: unit/lint/types/build, HTTP smoke входа и отзывов, HTTPS магазина,
www redirect, sitemap/robots без прежнего домена, отсутствие магазина на прежнем Host.
