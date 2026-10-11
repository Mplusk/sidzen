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
docker compose --project-name 3dprinta --env-file .env.production logs --tail=100 proxy
```

## Обновление секретов

Для смены `AUTH_SECRET` завершите активные сессии в базе и перезапустите приложение. Пароль PostgreSQL меняйте одновременно в роли БД, `POSTGRES_PASSWORD` и URL. Bootstrap-пароль влияет только на создание администратора: после первого входа управляйте пользователями через административный контур.
