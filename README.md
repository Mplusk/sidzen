# 3DPRINTA

Production-ready SSR интернет-магазин готовых изделий для [3dprinta.shop](https://3dprinta.shop).

## Возможности

- компактный SEO-first storefront: каталог, категории и карточки товаров;
- гостевая корзина, checkout, заказы, доставка и ручное подтверждение оплаты;
- личный кабинет с заказами, профилем и документами;
- административная панель с RBAC, товарами, заказами, контентом, SEO, файлами, настройками и аудитом;
- PostgreSQL, Prisma migrations/seed, приватное файловое хранилище;
- Docker Compose, Nginx, TLS, health-check, ротация логов, резервное копирование и CI/CD с rollback и очисткой прошлых версий.

## Стек

- Next.js 16, React 19, TypeScript;
- PostgreSQL 16 и Prisma 6;
- Vitest и ESLint;
- Docker Compose и Nginx.

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
src/lib/          auth, RBAC, pricing, анализ и storage
prisma/           схема, миграции и seed
public/generated/ изображения проекта
deploy/nginx/     bootstrap и production-конфигурации
scripts/          деплой и резервное копирование
```

## Безопасность

Секреты не коммитятся. Пользовательские 3D-файлы лежат вне `public`, выдаются только после проверки сессии/гостевого ключа/роли и получают `no-store`. Пароли хешируются через scrypt, сессии хранят только SHA-256 токена, cookies — `HttpOnly`, `SameSite=Lax`, `Secure` в production. Загрузки проверяются по расширению, сигнатуре, размеру, источнику и rate limit.
