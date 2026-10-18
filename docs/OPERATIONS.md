# Эксплуатация 3DPRINTA

## Production-переменные

Создайте `/opt/3dprinta/shared/.env.production` с правами `600`:

```dotenv
POSTGRES_PASSWORD=<случайный пароль>
DATABASE_URL=postgresql://3dprinta:<тот же URL-encoded пароль>@db:5432/3dprinta?schema=public
AUTH_SECRET=<минимум 32 случайных байта>
NEXT_PUBLIC_SITE_URL=https://sidzen.shop
UPLOAD_DIR=/app/private-uploads
MAX_UPLOAD_MB=100
BOOTSTRAP_ADMIN_EMAIL=admin@sidzen.shop
BOOTSTRAP_ADMIN_PASSWORD=<уникальный пароль>
PAYMENT_PROVIDER=manual
DELIVERY_PROVIDER=manual
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

## CI/CD и первый запуск

Workflow `.github/workflows/ci.yml` запускает Prisma validation, ESLint, TypeScript, Vitest и production build. После успешных проверок push в `main` автоматически:

1. формирует неизменяемый архив commit SHA;
2. передаёт его на сервер отдельным SSH-ключом пользователя деплоя;
3. собирает образы, применяет миграции и запускает release;
4. проверяет `/api/health/` и состояние БД;
5. проверяет ссылку cron-скрипта `/usr/local/sbin/3dprinta-backup` на `current/scripts/backup.sh` и переключает `/opt/3dprinta/current` на новый release;
6. только после успешного health check удаляет предыдущие release-каталоги, архивы, Docker build cache, остановленные контейнеры и неиспользуемые образы.

При ошибке сборки, миграции, старта, health check, проверки cron-скрипта или переключения `current` workflow завершается с ошибкой и пытается пересобрать и запустить предыдущий release. Volumes PostgreSQL, пользовательских моделей и изображений товаров никогда не очищаются.

Repository secrets:

```text
DEPLOY_HOST
DEPLOY_USER
DEPLOY_SSH_PRIVATE_KEY
DEPLOY_KNOWN_HOSTS
```

Для ручного первого запуска подготовьте `/opt/3dprinta/{incoming,releases,shared}`, поместите production env в `shared/.env.production`, затем загрузите архив commit SHA в `incoming` и вызовите `scripts/deploy-release.sh <full-sha>`.

Проверка текущего release:

```bash
cd /opt/3dprinta/current
docker compose --project-name 3dprinta --env-file .env.production ps
curl --fail http://127.0.0.1:3000/api/health/
```

Контейнер `migrate` применяет миграции и идемпотентный seed до запуска приложения.
Демонстрационный каталог и справочники заполняются только при первом запуске пустой БД. Последующие деплои не восстанавливают удалённые категории, материалы, цвета и другие записи, которыми управляют в `/admin/catalog/`.

## Новый сервер: Docker и HTTPS

С 28 сентября 2026 приложение, PostgreSQL и Caddy работают в одном Docker Compose проекте `3dprinta`. Контейнер Caddy принимает порты 80/443, получает и продлевает TLS-сертификаты автоматически. Приложение доступно с хоста только на `127.0.0.1:3000`, PostgreSQL не публикует порт наружу. Сертификаты, база и фотографии хранятся в постоянных volumes.

На чистом Ubuntu 24.04 выполните от root `bash scripts/provision-server.sh`. Скрипт установит Docker Engine и Compose из официального apt-репозитория, создаст deploy-пользователя, каталог проекта, cron резервных копий и случайные production-секреты. Повторный запуск не заменяет существующий `.env.production`. Добавьте SSH-ключ деплоя в `/home/deploy/.ssh/authorized_keys` и обновите repository secrets GitHub.

DNS `sidzen.shop` и `www.sidzen.shop` должен указывать на сервер. Caddy настраивается в `deploy/caddy/Caddyfile`; отдельные Nginx и Certbot для нового развёртывания не нужны. Проверка: `docker compose exec -T proxy caddy validate --config /etc/caddy/Caddyfile`, затем `curl --fail https://sidzen.shop/api/health/`.

Первый администратор: `admin@sidzen.shop`; автоматически сгенерированный пароль находится в `BOOTSTRAP_ADMIN_PASSWORD` production env. Секреты не попадают в репозиторий или журналы CI. После переустановки ОС старые товары, заказы и фотографии можно вернуть только из отдельной сохранённой резервной копии. Исходный код содержит демонстрационный каталог для пустой базы.

## Прежняя конфигурация Nginx

Файлы `deploy/nginx/` сохранены для совместимости прежней установки. При использовании контейнера Caddy их устанавливать не нужно.

## Резервное копирование

`scripts/backup.sh` сохраняет:

- PostgreSQL в custom-format dump;
- закрытый volume с моделями пользователей;
- volume с загруженными изображениями товаров;
- SHA-256 всех файлов резервной копии.

Пример cron (каждый день в 03:20 UTC):

```cron
20 3 * * * /usr/local/sbin/3dprinta-backup >> /var/log/3dprinta-backup.log 2>&1
```

Системный путь настраивается один раз от `root`: установленный wrapper сохраняется как `/opt/3dprinta/shared/3dprinta-backup.legacy`, затем `/usr/local/sbin/3dprinta-backup` атомарно заменяется ссылкой на `/opt/3dprinta/current/scripts/backup.sh`. Deploy-пользователь не получает прав на запись в `/usr/local/sbin`; CI/CD только проверяет ссылку до сборки и после health check. Поэтому cron всегда использует скрипт активного release, а удаление прежних release не ломает резервное копирование.

Проверка после выкладки: `readlink /usr/local/sbin/3dprinta-backup` должен вернуть `/opt/3dprinta/current/scripts/backup.sh`; `test -x /usr/local/sbin/3dprinta-backup` должен завершиться успешно. Саму резервную копию проверяйте отдельным запуском скрипта и сверкой `SHA256SUMS`.

Копии лежат в `/var/backups/3dprinta` не более 14 дней при ежедневном выполнении cron. Скрипт использует порог 12 дней и запас на суточную ротацию; увеличить его через переменную окружения нельзя. Контролируйте выполнение cron: ошибка копирования или остановленный сервер не доказывают удаление копий. Отдельные копии разрешены только в проверенном российском хранилище с той же ротацией. Не создавайте бессрочных копий с данными клиентов. Инвентаризацию и очистку ранее созданных ручных/offsite-копий выполняет оператор отдельно.

`privacy-ledger` — отдельный закрытый volume с зашифрованными техническими планами удаления (идентификаторы записей/файлов, без контактных значений). Он не откатывается вместе с базой. Скрипт сохраняет его резервную копию отдельно; для восстановления нужен **самый актуальный** журнал, а не журнал из старой восстанавливаемой копии. Ключ шифрования сохраняйте отдельно; при его ротации нужно перешифровать и журнал. Оператор оформляет подписанный акт уничтожения по приказу РКН № 179; JSON-выгрузка в админке — техническое приложение, не подписанный акт.

## Восстановление

Остановите публичный доступ, приложение и worker. Сохраните актуальный независимый `privacy-ledger` вне восстанавливаемой копии. Не откатывайте этот volume. Затем:

```bash
cd /opt/3dprinta/current
docker compose --project-name 3dprinta --env-file .env.production stop proxy app marketplace-worker
docker compose --project-name 3dprinta --env-file .env.production exec -T db pg_restore --clean --if-exists --no-owner -U 3dprinta -d 3dprinta < /var/backups/3dprinta/<timestamp>/database.dump
docker run --rm -v 3dprinta_model-files:/target -v /var/backups/3dprinta/<timestamp>:/backup:ro alpine:3.20 sh -c 'cd /target && tar -xzf /backup/model-files.tar.gz'
docker run --rm -v 3dprinta_product-images:/target -v /var/backups/3dprinta/<timestamp>:/backup:ro alpine:3.20 sh -c 'cd /target && tar -xzf /backup/product-images.tar.gz'
docker compose --project-name 3dprinta --env-file .env.production run --rm --no-deps migrate pnpm prisma migrate deploy
docker compose --project-name 3dprinta --env-file .env.production run --rm --no-deps marketplace-worker ./node_modules/.bin/tsx scripts/replay-privacy-erasures.ts --confirm-offline-restore
```

До запуска app/worker/proxy проверьте успешное применение журнала и удаление файлов. Повторный запуск безопасен: планы относятся только к исходным идентификаторам и не удаляют новые регистрации с тем же email. Если актуальный журнал утрачен или replay остановлен из-за обязательств/спора, **не открывайте публичный доступ**: восстановите журнал и сверяйте обращения вручную. Не загружайте вслепую старый `privacy-ledger.tar.gz` поверх нового volume. После проверки запустите сервисы и проверьте `/api/health/`, вход администратора, каталог и доступ к файлам заказа. Это обязательный этап восстановления, а не гарантия, обеспечиваемая самим `pg_restore`.

С 18.10.2026 персональный мониторинг прекращён. Восстановление старой копии обязательно завершается актуальными миграциями: `20261018120000_aggregate_page_views` очищает прежние визиты/согласия и запрещает повторную запись в старые таблицы на уровне БД. Не отключайте эти триггеры и не запускайте старую аналитику. Пустые таблицы оставлены только для безопасного отката приложения; новый Prisma-клиент их не использует. Новые счётчики содержат только дату, публичную страницу/товар и суточную сумму, без истории посетителей. Подробности — в `docs/monitoring.md`.

## Диагностика

```bash
cd /opt/3dprinta/current
docker compose --project-name 3dprinta --env-file .env.production ps
docker compose --project-name 3dprinta --env-file .env.production logs --tail=200 app
docker compose --project-name 3dprinta --env-file .env.production logs --tail=200 db
docker compose --project-name 3dprinta --env-file .env.production logs --tail=100 proxy
```

## Обновление секретов

Для смены `AUTH_SECRET` завершите активные сессии в базе и перезапустите приложение. Пароль PostgreSQL меняйте одновременно в роли БД, `POSTGRES_PASSWORD` и URL. Bootstrap-пароль влияет только на создание администратора: после первого входа управляйте пользователями через административный контур.
