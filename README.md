# ХОД - договорённость превращается в дело

ХОД - MVP для трека MAX «Эффективный бизнес». Он помогает руководителям небольших сервисных и операционных команд 5–50 человек не терять поручения из рабочих чатов: распознаёт потенциальную договорённость, просит человека подтвердить её, сопровождает исполнение и возвращает проверяемый результат.

Основной путь проходит в MAX. Чат-бот - точка входа и интерфейс коротких действий; Mini App дополняет его обзором дел, редактированием распознавания и защищённой загрузкой материалов. Без подтверждения пользователя AI не создаёт обязательство.

## Что реализовано

- групповой сценарий `сообщение → AI-предложение → подтверждение → Дело → выполнение → результат → VERIFIED`;
- личный сценарий `/start → пересылка сообщения → предложение → личное Дело`;
- ручное создание личного дела в боте и Mini App;
- состояния `NEW → ACCEPTED → IN_PROGRESS → DONE → VERIFIED`, возврат в работу и сохранённая совместимость со старыми `BLOCKED`-делами;
- напоминания, audit trail, идемпотентность webhook/callback, transactional outbox;
- фото, PDF и текстовые proof-материалы с авторизованной выдачей;
- production-интеграции только с официальными MAX SDK/API и GigaChat SDK.

## Архитектура

```text
MAX bot / MAX Mini App
          │
          ▼
Nginx :8080 ──► Fastify API :3000 ──► PostgreSQL (источник истины)
     │                 │             └► Redis/BullMQ (очереди и временное состояние)
     └──► React Mini App             └► worker ─► MAX / GigaChat
```

TypeScript monorepo: `apps/backend`, `apps/miniapp`, `packages/config`, `packages/contracts`. Бизнес-правила находятся в domain/application слоях; MAX, GigaChat, PostgreSQL и Redis изолированы в transport/infrastructure/integration.

## Запуск одной командой

Нужен Docker с Compose v2. Для проверки без внешних credentials:

```powershell
docker compose up --build
```

После готовности:

- Mini App: `http://localhost:8080/`;
- liveness: `http://localhost:8080/health/live`;
- readiness: `http://localhost:8080/health/ready`;
- PostgreSQL для локальных инструментов: `127.0.0.1:55432`;
- Redis для локальных инструментов: `127.0.0.1:56379`.

Если host-порт занят или зарезервирован ОС, задайте `APP_HOST_PORT`, `POSTGRES_HOST_PORT` и `REDIS_HOST_PORT` в `.env`; внутренние адреса контейнеров не меняются.

Compose один раз собирает общий backend image, поднимает PostgreSQL и Redis, применяет SQL-миграции one-shot сервисом `migrate`, затем запускает backend, worker, Mini App и Nginx. По умолчанию `MAX_TRANSPORT=disabled` и `AI_PROVIDER=disabled`: локальный UI и API доступны, но live MAX/AI путь требует credentials.

`/health/live` означает, что HTTP-процесс жив. `/health/ready` проверяет PostgreSQL и Redis, а при включённом MAX также успешный запуск MAX runtime. Backend не начинает слушать порт и освобождает ресурсы, если обязательный MAX startup завершился ошибкой.

Остановка и повторный запуск:

```powershell
docker compose down
docker compose up --build
```

Обычный `down` сохраняет volumes. `docker compose down -v` удаляет локальные данные без возможности восстановления.

## Настройка окружения

Скопируйте `.env.example` в `.env`. `.env` игнорируется Git и Docker build context. Пустые секреты — намеренные placeholders.

| Переменная | Назначение | Обязательна | Безопасный пример | Компонент |
| --- | --- | --- | --- | --- |
| `NODE_ENV` | режим runtime | да | `production` | backend/worker |
| `PORT` | внутренний HTTP-порт | да | `3000` | backend |
| `LOG_LEVEL` | уровень логов | да | `info` | backend/worker |
| `APP_HOST_PORT` | host-порт Nginx | да | `8080` | Docker Compose |
| `POSTGRES_HOST_PORT` | host-порт PostgreSQL | да | `55432` | Docker Compose |
| `REDIS_HOST_PORT` | host-порт Redis | да | `56379` | Docker Compose |
| `DATABASE_URL` | PostgreSQL DSN | да | `postgresql://hod:hod@postgres:5432/hod` | backend/worker/migrate |
| `REDIS_URL` | Redis DSN | да | `redis://redis:6379` | backend/worker |
| `WORKSPACE_DEFAULT_TIMEZONE` | IANA timezone новых пространств | да | `Asia/Krasnoyarsk` | backend/worker |
| `MAX_TRANSPORT` | `disabled`, `webhook` или dev-only `polling` | да | `disabled` | backend |
| `MAX_BOT_TOKEN` | токен MAX-бота | при включённом MAX | пусто | backend/worker |
| `MAX_API_BASE_URL` | официальный MAX API | да | `https://platform-api2.max.ru` | backend/worker |
| `MAX_CA_BUNDLE_PATH` | локальный PEM bundle для Compose override | для live MAX при необходимости | `./serifo/max-ca-bundle.pem` | Docker Compose |
| `MAX_WEBHOOK_PUBLIC_URL` | публичный HTTPS webhook на 443 | для webhook | `https://example.ru/max/webhook` | backend |
| `MAX_WEBHOOK_SECRET` | секрет подписи webhook | для webhook | пусто | backend |
| `MAX_MINIAPP_BOT_NAME` | username бота для `startapp` deep link | для link-кнопок | `hod_demo_bot` | backend/worker |
| `AI_PROVIDER` | `disabled`, `gigachat`; `fake` только не в production | да | `disabled` | worker |
| `AI_HIGH_CONFIDENCE_THRESHOLD` | порог high confidence | да | `0.85` | worker |
| `AI_MEDIUM_CONFIDENCE_THRESHOLD` | порог ручного уточнения | да | `0.60` | worker |
| `GIGACHAT_CREDENTIALS` | Authorization Key | для GigaChat | пусто | worker |
| `GIGACHAT_SCOPE` | scope выданного ключа | для GigaChat | `GIGACHAT_API_B2B` | worker |
| `GIGACHAT_MODEL` | модель | для GigaChat | `GigaChat-2-Pro` | worker |
| `GIGACHAT_BASE_URL` | HTTPS endpoint GigaChat | для GigaChat | `https://api.giga.chat` | worker |
| `GIGACHAT_TIMEOUT_MS` | timeout запроса | да | `60000` | worker |
| `GIGACHAT_CA_BUNDLE_PATH` | PEM bundle для Compose override | при необходимости | `./serifo/gigachat-ca-bundle.pem` | Docker Compose |
| `MINIAPP_SESSION_TTL_SECONDS` | TTL серверной сессии | да | `28800` | backend |
| `MAX_INIT_DATA_MAX_AGE_SECONDS` | допустимый возраст MAX initData | да | `300` | backend |
| `MINIAPP_DEV_AUTH` | dev-only вход без MAX | нет | `false` | backend |
| `MINIAPP_DEV_EXTERNAL_USER_ID` | существующий MAX user id для dev | нет | пусто | backend |
| `REMINDER_LEAD_MINUTES` | опережение напоминания | да | `60` | worker |
| `REMINDER_SCAN_INTERVAL_SECONDS` | период сканирования reminders | да | `60` | worker |
| `OUTBOX_POLL_INTERVAL_MS` | период outbox dispatcher | да | `1000` | worker |
| `OUTBOX_RETENTION_DAYS` | хранение отправленных событий | да | `7` | worker |
| `MAX_RATE_LIMIT_PER_SECOND` | общий лимит очереди исходящих MAX-уведомлений; дополнительно действует лимит 2 сообщения/с на адресата | да | `10` | worker |
| `PROOF_STORAGE_PATH` | каталог proof-файлов | да | `/data/proofs` | backend/worker |
| `PROOF_MAX_BYTES` | лимит одного файла | да | `10485760` | backend/worker |
| `MINIAPP_ORIGIN` | разрешённый origin Mini App | да | `http://localhost:8080` | backend |

Production/live MAX и GigaChat запускаются с тем же набором overlays, который использует `scripts/deploy.sh`:

```powershell
docker compose -f docker-compose.yml -f docker-compose.max.yml -f docker-compose.gigachat.yml up --build
```

Production deploy требует `MAX_TRANSPORT=webhook`, `AI_PROVIDER=gigachat`, оба CA-файла и соответствующие credentials в серверном `.env`. GigaChat CA подключается к worker через `NODE_EXTRA_CA_CERTS`; TLS-проверка не отключается. Публичный ingress обязан завершать HTTPS; локальный Nginx слушает HTTP `8080`.

## Проверка основного сценария в MAX

Предварительно добавьте бота администратором в тестовую группу, выдайте `read_all_messages`, настройте постоянную кнопку Mini App в кабинете MAX и webhook.

1. Отправьте в группе: «Антон, завтра проверь кондиционер на Пушкина и пришли фото». Ожидается карточка предложения, а не автоматическое дело.
2. Автор нажимает «В дело». Ожидается одно `NEW`-дело и уведомление исполнителю; повторное нажатие дубль не создаёт.
3. Исполнитель нажимает «Принять», затем начинает работу. Ожидаются `ACCEPTED`, затем `IN_PROGRESS`.
4. Для PHOTO/FILE исполнитель сначала добавляет требуемое вложение и завершает дело. Backend отклоняет `SUBMIT_RESULT` без proof; после загрузки ожидаются `DONE` и уведомление инициатору.
5. Инициатор принимает результат. Ожидается `VERIFIED`, audit trail и видимость дела в Mini App.
6. Повторите с возвратом результата. Ожидается `DONE → IN_PROGRESS` с сохранённой причиной.

Личный smoke: `/start` → «Перешлите сообщение» → переслать задачу → «В дело» → «Мои дела». Ожидается self-assigned Action. Обычный личный текст не запускает AI.

## Локальная разработка и тесты

Для host-run нужны Node.js 24 и npm, совместимый с lockfile:

```powershell
npm.cmd ci
npm.cmd run verify
npm.cmd audit --audit-level=high
npm.cmd run eval:validate
```

Integration suite использует отдельную БД и очищает fixtures; основная БД `hod` запрещена fail-fast:

```powershell
docker compose up -d postgres redis
docker compose exec postgres psql -U hod -d postgres -c "CREATE DATABASE hod_test OWNER hod;"
$env:TEST_DATABASE_URL='postgresql://hod:hod@localhost:55432/hod_test'
$env:TEST_REDIS_URL='redis://localhost:56379/15'
npm.cmd run test:integration
```

Golden dataset — синтетический набор из 160 размеченных фраз. `AI_PROVIDER=fake` используется только в автоматических/local тестах и запрещён схемой конфигурации в production. Credentialed GigaChat smoke (`npm.cmd run test:gigachat`) и live MAX-путь не входят в офлайн `verify`.

## API и данные

Backend является собственным session-authenticated API Mini App по адресу `https://max.mi-kod.ru`. Контракт: [openapi.yaml](openapi.yaml); `node scripts/check-openapi.mjs` сопоставляет его со всеми public routes. Машиночитаемый порядок проверки: [DATA-API.yaml](DATA-API.yaml), а набор воспроизводимых синтетических данных: [api-test-data.json](api-test-data.json). Production-аутентификация требует подписанный MAX `initData`; production credentials не хранятся в Git.

Для проверки публичного API откройте [бота](https://max.ru/t252_hakaton_max_bot) в MAX и войдите в [тестовую беседу](https://max.ru/join/HYzBHJBc_LAWMGg0FexqzpPVdl7UMzngIbuyIERBFT0) со своим аккаунтом. В беседе уже есть участники, которым можно назначить дело; для самостоятельного прохождения обеих ролей используйте два своих аккаунта. Откройте Mini App из MAX: она передаст свежий подписанный `initData` в `POST /api/auth/max` и получит HttpOnly cookie `hod_session`. С этим cookie доступны защищённые `/api/*` методы в рамках прав пользователя. Отдельных тестовых логинов, паролей или ключей для проверки работающего стенда нет; `GET https://max.mi-kod.ru/health/ready` доступен без входа.

Для проверки ролей и изоляции данных без зависимости от участников беседы доступны изолированный `docker-compose.api-test.yml` и детерминированные fixtures из `api-test-data.json`. Они включают dev auth только у локального backend и не работают в production:

```powershell
docker compose -f docker-compose.yml -f docker-compose.api-test.yml up -d --build
Get-Content -Raw scripts/api-test-seed.sql | docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U hod -d hod
# POST /api/auth/dev с externalUserId из DATA-API.yaml
Get-Content -Raw scripts/api-test-reset.sql | docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U hod -d hod
```

Seed/reset затрагивают только перечисленные в `DATA-API.yaml` стабильные UUID и не выполняют `TRUNCATE`.

PostgreSQL хранит доменное состояние, audit, detection, attachment metadata и outbox. Redis хранит очереди, короткий conversation context, dedup и сессии. Proof-файлы находятся вне web root. GigaChat получает trigger и максимум четыре соседних сообщения, timezone и отображаемые имена; результат проходит JSON Schema и локальную Zod/domain validation.

При включённом AI каждое групповое сообщение активного участника ставится в очередь детекции; предварительного фильтра нет. Для исходящих уведомлений worker резервирует в Redis не более двух отправок в секунду на диалог или чат. Ответ MAX `429` с `Retry-After` обрабатывается ограниченным повтором до возврата ошибки в очередь.

## Платформенная ценность MAX

Кроме обмена сообщениями используются callback-кнопки, `/start`, `bot_started`, события групп и участников, Mini App `initData`, `startapp` deep links, защищённая работа с файлами и редактирование callback-сообщения после действия. Это органично сокращает путь от договорённости до подтверждённого результата. Автотесты подтверждают контракты и сценарии; команда сообщает, что вручную прошла live E2E в MAX. Решение о платформенном бонусе остаётся за жюри.

В native MAX proof скачивается через `window.WebApp.downloadFile`; на платформе `web` остаётся обычная авторизованная HTTPS-ссылка.

## Известные ограничения

- live MAX, публичный HTTPS, credentials и полный GigaChat eval нельзя воспроизвести без внешних настроек;
- proof storage локальный и рассчитан на один deployment; object storage, malware scanning и multi-node replication вне MVP;
- нет CRM/ERP/1С/Jira, универсального AI-чата, Kanban и автономного создания дел;
- для неоднозначного исполнителя требуется ручной выбор; зависимый/относительный срок не получает выдуманного времени;
- постоянная кнопка Mini App и `read_all_messages` настраиваются владельцем бота в MAX вручную.
- MIME upload проверяется по multipart metadata без content sniffing; отсутствуют malware scanning и общий HTTP rate limiter; mutation guard отклоняет чужой `Origin`, но допускает отсутствие заголовка. Эти ограничения требуют учёта при эксплуатации вне демонстрационного MVP.

## Troubleshooting

- `readiness` возвращает 503: проверьте `docker compose ps` и логи `postgres`, `redis`, `migrate`, `backend`; при включённом MAX поле `dependencies.max` также обязано быть `up`.
- MAX не отвечает: проверьте `MAX_TRANSPORT`, токен, webhook HTTPS/443, secret, CA bundle и подписку; не отключайте TLS.
- Бот не видит сообщения группы: выдайте ему административное право `read_all_messages`.
- Mini App не авторизуется: проверьте токен бота, свежесть `initData`, `MINIAPP_ORIGIN` и членство пользователя.
- GigaChat не отвечает: проверьте scope, credentials, CA bundle, модель и timeout командой `npm.cmd run test:gigachat`.
- Файл не загружается: допустимы JPEG, PNG, WebP, HEIC/HEIF, PDF, TXT, DOC/DOCX и XLS/XLSX, размер до `PROOF_MAX_BYTES`; мобильный `application/octet-stream` распознаётся только по разрешённому расширению.
- Proof не скачивается в MAX: требуется публичный HTTPS URL и поддержка `window.WebApp.downloadFile`; отдельно проверьте mobile и web clients.
- `npm` в PowerShell блокируется policy: используйте `npm.cmd`.
- integration tests отказываются запускаться: задайте отдельную `hod_test`, не `hod` и не `postgres`.

