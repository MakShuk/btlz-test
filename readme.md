# Установка и настройка

## Шаг 1: Подготовка конфигурации

Скопируйте файл с примером конфигурации:

```bash
cp example.env .env
```

## Шаг 2: Настройка переменных окружения

Откройте файл .env и заполните следующие параметры:

### Google Cloud credentials

Получите учетные данные сервисного аккаунта:

1. Перейдите в Google Cloud Console
2. Откройте IAM & Admin → Service Accounts
3. Создайте новый сервисный аккаунт или выберите существующий
4. Сгенерируйте JSON-ключ и скопируйте его содержимое

```text
GOOGLE_CREDENTIALS_JSON={"type":"service_account","project_id":"your-project-id","private_key_id":"...","private_key":"...","client_email":"...","client_id":"...","auth_uri":"https://accounts.google.com/o/oauth2/auth","token_uri":"https://oauth2.googleapis.com/token","auth_provider_x509_cert_url":"https://www.googleapis.com/oauth2/v1/certs","client_x509_cert_url":"..."}
```

### Google Sheets IDs

Укажите идентификаторы таблиц Google Sheets через запятую (ID находится в URL таблицы):

```text
GOOGLE_SHEET_IDS=1abc123def456,2ghi789jkl012
```

### Wildberries API Token

```text
WB_API_TOKEN=YOUR_WB_TOKEN
```

## Шаг 3: Запуск приложения

Запустите контейнеры с помощью Docker Compose:

```bash
docker compose up
```

Для запуска в фоновом режиме добавьте флаг -d:

```bash
docker compose up -d
```

> **Примечание:** Убедитесь, что у сервисного аккаунта Google есть права доступа к указанным таблицам (Editor или Viewer в зависимости от требуемых операций).