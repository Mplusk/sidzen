# Эксплуатация 3DPRINTA

## Production-переменные

Создайте `/opt/3dprinta/.env.production` с правами `600`:

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

## Первый запуск

```bash
cd /opt/3dprinta
docker compose --env-file .env.production build
docker compose --env-file .env.production up -d
docker compose --env-file .env.production ps
curl --fail http://127.0.0.1:3000/api/health/
```

Контейнер `migrate` применяет миграции и идемпотентный seed до запуска приложения. Повторный деплой выполняется `scripts/deploy.sh`.

## Nginx и HTTPS

До получения сертификата установите `deploy/nginx/bootstrap.conf`. После успешного Certbot замените его на `deploy/nginx/3dprinta.conf` и выполните `nginx -t && systemctl reload nginx`. Запросы к `www` перенаправляются на основной домен, HTTP — на HTTPS. Nginx разрешает загрузки до 105 МБ.

## Резервное копирование

`scripts/backup.sh` сохраняет:

- PostgreSQL в custom-format dump;
- закрытый volume с моделями пользователей;
- SHA-256 обоих архивов.

Пример cron (каждый день в 03:20 UTC):

```cron
20 3 * * * /opt/3dprinta/scripts/backup.sh >> /var/log/3dprinta-backup.log 2>&1
```

По умолчанию копии лежат в `/var/backups/3dprinta` 14 дней. Минимум раз в месяц копируйте их на отдельный сервер или объектное хранилище.

## Восстановление

Остановите приём новых заказов, затем:

```bash
cd /opt/3dprinta
docker compose --env-file .env.production exec -T db pg_restore --clean --if-exists --no-owner -U 3dprinta -d 3dprinta < /var/backups/3dprinta/<timestamp>/database.dump
docker run --rm -v 3dprinta_model-files:/target -v /var/backups/3dprinta/<timestamp>:/backup:ro alpine:3.20 sh -c 'cd /target && tar -xzf /backup/model-files.tar.gz'
```

После восстановления проверьте `/api/health/`, вход администратора, каталог и доступ к файлам заказа.

## Диагностика

```bash
docker compose --env-file .env.production ps
docker compose --env-file .env.production logs --tail=200 app
docker compose --env-file .env.production logs --tail=200 db
nginx -t
certbot certificates
```

## Обновление секретов

Для смены `AUTH_SECRET` завершите активные сессии в базе и перезапустите приложение. Пароль PostgreSQL меняйте одновременно в роли БД, `POSTGRES_PASSWORD` и URL. Bootstrap-пароль влияет только на создание администратора: после первого входа управляйте пользователями через административный контур.
