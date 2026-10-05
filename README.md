# 3DPRINTA

Production-ready SSR интернет-магазин готовых изделий для [3dprinta.shop](https://3dprinta.shop).

## Возможности

- компактный SEO-first storefront: каталог, категории и карточки товаров;
- гостевая корзина, checkout, заказы, доставка и ручное подтверждение оплаты;
- онлайн-оплата через интернет-эквайринг Точки: карта / СБП, зашифрованные настройки в ЛК, платёжные ссылки, проверка уведомлений и фоновая сверка; [инструкция подключения](docs/TOCHKA.md);
- личный кабинет с заказами, профилем и документами;
- административная панель с RBAC, полным созданием и редактированием товаров и справочников категорий/производства, заказами, SEO, настройками и аудитом;
- визуальная загрузка нескольких фотографий, выбор обложки, изменение порядка и компактная галерея со стрелками, миниатюрами и свайпом;
- удаление заказов сотрудниками с правом управления заказами: подтверждение, удаление связанных записей и журнал аудита в одной транзакции;
- постоянное хранилище фотографий, которое не удаляется при деплое;
- PostgreSQL, Prisma migrations/seed, приватное файловое хранилище;
- Docker Compose, Caddy с автоматическим HTTPS, health-check, ротация логов, резервное копирование и CI/CD с rollback и очисткой прошлых версий.

## Стек

- Next.js 16, React 19, TypeScript;
- PostgreSQL 16 и Prisma 6;
- Vitest и ESLint;
- Docker Compose и Caddy.

## Локальный запуск

Требуются Node.js 22+, pnpm 10 и PostgreSQL.

```bash
cp .env.example .env
pnpm install
pnpm prisma migrate deploy
pnpm db:seed
pnpm dev
```

Не используйте значения-заглушки из `.env.example` в production.

## Проверка

```bash
pnpm prisma validate
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Production

Production-процедуры, переменные, резервное копирование и восстановление описаны в [docs/OPERATIONS.md](docs/OPERATIONS.md). Соответствие техническому заданию и принятые решения — в [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md).

## Структура

```text
src/app/          страницы, server actions и API
src/components/   UI-компоненты storefront
src/lib/          auth, RBAC, расчёт товаров и платёжные подключения
prisma/           схема, миграции и seed
public/generated/ изображения проекта
deploy/caddy/     HTTPS-прокси в контейнере
scripts/          деплой и резервное копирование
```

## Безопасность

Секреты не коммитятся. Пароли хешируются через scrypt, сессии хранят только SHA-256 токена, cookies — `HttpOnly`, `SameSite=Lax`, `Secure` в production. Загрузки фотографий проверяются по типу, сигнатуре, размеру, источнику и rate limit. Секреты платёжного подключения в базе зашифрованы.
