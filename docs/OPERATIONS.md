# Эксплуатация 3DPRINTA

## Production-переменные

Создайте `/opt/3dprinta/shared/.env.production` с правами `600`:

```dotenv
POSTGRES_PASSWORD=<случайный пароль>
DATABASE_URL=postgresql://3dprinta:<тот же URL-encoded пароль>@db:5432/3dprinta?schema=public
AUTH_SECRET=<минимум 32 случайных байта>
NEXT_PUBLIC_SITE_URL=https://3dprinta.shop
UPLOAD_DIR=/app/private-uploads
MAX_UPLOAD_MB=100
BOOTSTRAP_ADMIN_EMAIL=admin@3dprinta.shop
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
5. атомарно направляет cron-скрипт `/usr/local/sbin/3dprinta-backup` на `current/scripts/backup.sh` и переключает `/opt/3dprinta/current` на новый release;
6. только после успешного health check удаляет предыдущие release-каталоги, архивы, Docker build cache, остановленные контейнеры и неиспользуемые образы.

При ошибке сборки, миграции, старта, health check, обновления cron-скрипта или переключения `current` workflow завершается с ошибкой и пытается пересобрать и запустить предыдущий release. Volumes PostgreSQL, пользовательских моделей и изображений товаров никогда не очищаются.

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

## Nginx и HTTPS

До получения сертификата установите `deploy/nginx/bootstrap.conf`. После успешного Certbot замените его на `deploy/nginx/3dprinta.conf` и выполните `nginx -t && systemctl reload nginx`. Запросы к `www` перенаправляются на основной домен, HTTP — на HTTPS. Nginx разрешает загрузки до 105 МБ.

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

После успешного health check deploy атомарно делает этот путь ссылкой на `/opt/3dprinta/current/scripts/backup.sh`. Поэтому cron всегда использует скрипт активного release, а удаление прежних release не ломает резервное копирование. При первом переносе установленный ранее wrapper сохраняется как `/opt/3dprinta/shared/3dprinta-backup.legacy`.

Проверка после выкладки: `readlink /usr/local/sbin/3dprinta-backup` должен вернуть `/opt/3dprinta/current/scripts/backup.sh`; `test -x /usr/local/sbin/3dprinta-backup` должен завершиться успешно. Саму резервную копию проверяйте отдельным запуском скрипта и сверкой `SHA256SUMS`.

По умолчанию копии лежат в `/var/backups/3dprinta` 14 дней. Минимум раз в месяц копируйте их на отдельный сервер или объектное хранилище.

## Восстановление

Остановите приём новых заказов, затем:

```bash
cd /opt/3dprinta/current
docker compose --project-name 3dprinta --env-file .env.production exec -T db pg_restore --clean --if-exists --no-owner -U 3dprinta -d 3dprinta < /var/backups/3dprinta/<timestamp>/database.dump
docker run --rm -v 3dprinta_model-files:/target -v /var/backups/3dprinta/<timestamp>:/backup:ro alpine:3.20 sh -c 'cd /target && tar -xzf /backup/model-files.tar.gz'
docker run --rm -v 3dprinta_product-images:/target -v /var/backups/3dprinta/<timestamp>:/backup:ro alpine:3.20 sh -c 'cd /target && tar -xzf /backup/product-images.tar.gz'
```

После восстановления проверьте `/api/health/`, вход администратора, каталог и доступ к файлам заказа.

## Диагностика

```bash
cd /opt/3dprinta/current
docker compose --project-name 3dprinta --env-file .env.production ps
docker compose --project-name 3dprinta --env-file .env.production logs --tail=200 app
docker compose --project-name 3dprinta --env-file .env.production logs --tail=200 db
nginx -t
certbot certificates
```

## Обновление секретов

Для смены `AUTH_SECRET` завершите активные сессии в базе и перезапустите приложение. Пароль PostgreSQL меняйте одновременно в роли БД, `POSTGRES_PASSWORD` и URL. Bootstrap-пароль влияет только на создание администратора: после первого входа управляйте пользователями через административный контур.
