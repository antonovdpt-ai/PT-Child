# Изолированный staging Fizira: план создания и runtime-проверки

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan stage-by-stage. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Проверить завершённые Task1–Task8 на настоящих Auth, PostgreSQL, Storage и Edge Runtime, не обращаясь к production и не используя реальные данные.

**Architecture:** Отдельный временный VPS в РФ, отдельная установка self-hosted Supabase, собственные Docker volumes, сеть и секреты. Frontend: `https://staging.fizira.com`; API/Auth/Storage/Functions: `https://staging-auth.fizira.com`. Письма направляются только во внутренний SMTP-приёмник, например Mailpit; ни одна production-служба не используется.

**Tech Stack:** Linux, Docker Compose, Caddy, self-hosted Supabase (PostgreSQL, Auth, REST, Storage, Edge Runtime), Node для существующего synthetic runner; браузер для UI acceptance.

**Spec:** Требования пользователя от 04.10.2026; `docs/superpowers/specs/2026-10-02-parent-portal-design.md`; runtime-критерии `ops/parent-portal/README.md`.

## Global Constraints

- Не изменять и не тестировать production `app.fizira.com`, `auth.fizira.com`, его сервер, БД, Auth, Storage, DNS-записи или рабочие процессы deployment.
- Не выполнять merge в main, push или production deployment в рамках этого плана.
- Только вымышленные данные и отдельные специалист/родитель аккаунты; никаких дампов, snapshot-клонов или объектов production.
- Секреты генерировать на staging-сервере; хранить вне Git, в файлах с правами 600. В чат, браузерные артефакты и логи их не помещать. В frontend допустим только собственный staging anon/publishable key.
- До ручного шага Timeweb/DNS/подключения остановиться и дать пользователю ровно одно следующее действие. Создание платного сервера не выполняется автоматически.
- Существующие Task1–Task8 остаются восемью завершёнными задачами реализации. Ниже — отдельные этапы runtime-подготовки, не повторная реализация.

## Фактическое состояние и границы исследования

Исследован локальный `codex/parent-portal` на `f65342e`; дерево чистое. GitHub main ранее проверен как `f9f4220`; локальная цепочка до удалённого checkpoint подтверждена. Production не опрашивался.

| Область | Реальный факт | Следствие для staging |
| --- | --- | --- |
| Frontend | Статические ES modules; `app.js` и `parent.js` содержат production Supabase URL и публичный ключ | Нужна явная конфигурация среды, а не копирование файлов |
| Файлы родителя | `parent.js` проверяет signed URL относительно `https://auth.fizira.com` | Настроить проверку на origin отдельного staging API, сохранив same-origin HTTPS ограничение |
| Приглашения | `_shared/parent-portal.ts` создаёт redirect на `https://app.fizira.com/parent.html?invite=…` | Нужна серверная настройка доверенного frontend origin до любых приглашений |
| CORS | Edge helpers поддерживают `FIZIRA_ALLOWED_ORIGINS`, default production | На staging задавать только staging origin; отсутствующая/неверная staging-конфигурация должна останавливать запуск |
| Схема | Есть миграции 001–012 и строгий read-only verifier; full-schema fixture исполняет все 12 | Создать пустой Supabase и применить SQL последовательно; не переносить пользователей/данные |
| Platform deployment | Compose/Caddy полной установки в репозитории нет; `supabase/config.toml` содержит font static_files, не готовый сервер | Требуется отдельно закреплённая конфигурация platform runtime |
| Существующие scripts | AI `install-yandex-edge-staging.sh` использует `/root/supabase-project`, старый SHA и production URL | Не использовать эти scripts для нового стенда |
| CI/SSH | Workflows используют `TIMEWEB_*` secrets и production пути | Это схема подключения, не доступный staging-канал; не запускать production workflows |
| Текущая среда агента | Нет SSH identity/Timeweb/staging env; нет Docker, Deno, psql, Supabase CLI | Доступ к стенду потребует отдельного шага, пароли в чат не нужны |

## Выбор размещения

Рекомендуется отдельный VPS: можно удалить весь стенд с неизменяемым тестовым аудитом, не затрагивая production. Второй Compose на production VPS имеет общий Docker daemon, диски и административную границу, а ошибка пути/volume может повредить рабочую установку; этот вариант отвергнут. Managed Supabase допустим только как иной отдельно согласованный вариант: он не проверяет self-hosted deployment Fizira на Timeweb.

Начальная конфигурация отдельного VPS: 2 vCPU, 4 GB RAM, 40 GB SSD, РФ, чистая Ubuntu LTS. Это минимальные опубликованные требования полного Supabase; если PDF/runtime-проверки упираются в память, увеличить только staging. Версию ОС окончательно выбрать по поддержке закреплённых Docker/Compose образов. Не включать AI/Yandex, внешнее SMTP, production backup jobs или account deletion timers.

Официальные источники, проверенные 04.10.2026:
- https://supabase.com/docs/guides/self-hosting/docker — ресурсы, отдельные секреты и URL.
- https://timeweb.cloud/docs/cloud-servers/manage-servers/create-server — создание отдельного VPS.

## Review Focus

1. Старый frontend, импорт или redirect способен незаметно направить запрос в production: staging gate должен отказать до создания аккаунтов.
2. JWT/API key другого экземпляра не должен авторизоваться в staging; не получать production токены ради теста.
3. Source photo и PDF, вошедшие в publication, нельзя изменить через Storage API, S3 или административную прикладную RPC.
4. Invite/accept/resend, публикация и запоздавшие file/profile ответы после смены ребёнка/аккаунта должны проверяться реальными конкурентными запросами.
5. Mailpit подтверждает шаблоны и Auth-переходы, но не внешнюю доставку SMTP; не выдавать эту проверку за успешную доставку реальных писем.

## Этап 1. Отдельный сервер и безопасный канал доступа

**Deliverable:** идентифицированный VPS staging, к которому можно подключиться без доступа к production.

- [ ] Пользователь открывает форму создания нового облачного сервера Timeweb; не выбирает существующий production сервер и не подтверждает оплату на этом шаге.
- [ ] Сверить предлагаемые ОС/регион/ресурсы/цену в форме. Отдельным ручным шагом подтвердить создание `fizira-staging`.
- [ ] Подключить отдельный SSH public key либо существующий ключ, только если подтверждены его назначение и доступность. Не запрашивать приватный ключ/пароль в чате. Подтвердить host fingerprint через доверенный канал панели.
- [ ] Использовать отдельный staging deploy user; если понадобится GitHub Actions, создать отдельный environment `staging` со staging host/key/known_hosts secrets через защищённый интерфейс. Не переиспользовать `TIMEWEB_*` production secrets.
- [ ] Проверить на новом сервере identity, mounts, отсутствие clinical/Auth data; установить Docker/Compose и firewall. Управление доступно по SSH, внешний трафик только HTTPS/ACME; PostgreSQL, SMTP, Studio и admin ports не публиковать.

**Gate:** запись с ID нового сервера, IP, host fingerprint, путями и resource configuration без секретов; отсутствие production mounts/credentials.

## Этап 2. Воспроизводимый пустой backend

**Planned files:** `ops/staging/compose.yml`, `ops/staging/Caddyfile`, `ops/staging/staging.env.example`, `ops/staging/README.md`, `ops/staging/preflight.mjs`, `ops/staging/preflight.test.mjs`.

- [ ] Закрепить совместимые версии/образ digests Supabase и PostgreSQL с учётом схемы и verifier. В репозитории нет достоверного полного platform manifest production; не объявлять parity с ним и не читать production для этого этапа. Не выбирать автоматически latest и не ослаблять verifier из-за версии.
- [ ] Написать RED тест preflight: отказ для production hostname/URL, production default paths, отсутствующего target marker, неверного signing-key/API-key набора и публичных DB/admin ports.
- [ ] Создать отдельный Compose project `fizira-staging`, volumes только внутри `/srv/fizira-staging`, отдельные DB/JWT/API/encryption/dashboard secrets. Не монтировать production backup buckets, Docker/socket remote hosts или старые директории.
- [ ] Подключить только нужные службы: DB, Auth, REST, Storage и его image helper, gateway, Edge Runtime, HTTPS/static proxy, внутренний SMTP sink. При наличии Studio ограничить localhost/SSH tunnel. Не включать необязательные analytics/AI.
- [ ] Установить egress policy, исключающую production API/Storage/server; разрешить только необходимые installation/runtime dependency endpoints. Замкнуть SMTP на внутренний sink; не подключать production SMTP/Yandex/rclone.
- [ ] Запустить платформу до SQL; подтвердить готовность реальных `auth.users`, `storage.objects`, `storage.buckets`, `auth.uid()` и нужных extensions. Применить 001–012 в порядке fixture через `psql -X -v ON_ERROR_STOP=1`; 002 — checked-in security delta, уже проверенная после 001 в full-schema fixture.
- [ ] Запустить `supabase/verification/verify_parent_portal.sql` в read-only transaction. При owner/deparser/storage mismatch — STOP, исследовать конкретное отличие, не генерировать reference из live SQL.
- [ ] GREEN preflight и проверка исключения foreign JWT, подписанного отдельным тестовым ключом. Сохранить hashes/версии и обезличенные результаты; сделать и восстановить backup только synthetic стенда на отдельном временном экземпляре.

**Gate:** реальный verifier PASS, health PASS, новая пустая БД, нет production destinations/secrets. Нельзя обещать полную защиту от администратора, имеющего самостоятельный доступ к обоим серверам; цель — исключить такой доступ у staging процессов и автоматики.

## Этап 3. Staging endpoints без изменения production поведения

**Planned files:** `runtime-config.mjs`, `tests/runtime-config.test.mjs`; изменения `app.js`, `parent.js`, `_shared/parent-portal.ts` и его tests; manifests/cache tests; отдельный staging package script.

- [ ] RED тесты: на `staging.fizira.com` нельзя создать Supabase client без staging config; production API/ключ и неизвестный host отвергаются; signed files допускаются только с configured staging API origin; invite redirect строго на staging frontend.
- [ ] Определить `resolveRuntimeConfig(hostname, config)` → `{supabaseUrl, publishableKey}`: явный allowlist известных frontend hosts, без fallback на production для staging/unknown host. Общая конфигурация используется обоими clients и parent file validation. Secret/service key в конфигурации запрещён.
- [ ] Для invitations добавить server-only `FIZIRA_PARENT_APP_ORIGIN`; default сохранить для существующего production поведения, на staging обязательна точная пара frontend/API endpoints. Валидировать HTTPS origin без path/query/userinfo; CORS также только staging. Изменение ограничить конфигурацией, не менять grants/RPC/immutable semantics.
- [ ] Обновить manifests/cache markers для новых imports. Собрать staging из конкретного local branch SHA, не выполнять main workflow. Запретить production endpoints в активных JS/config и staging outgoing browser/API navigation; legal documents оставить опубликованными источниками, без перенаправлений тестовых Auth flows в production.
- [ ] Проверить backend/API configuration consistency: публичный gateway, Auth `SITE_URL`, redirect allowlist только точных staging login/parent/recovery URLs; browser auth storage и сессии отдельного host. Не использовать wildcard `*.fizira.com` cookies/redirects.
- [ ] Развернуть все пять parent Edge Functions и общий код/font/license. Отдельно проверить self-hosted Edge routing/JWT verification и font filesystem packaging: CLI static_files сам по себе не доказывает Docker packaging. AI может оставаться disabled; специалистские CRUD/PDF пути проверяются без AI.
- [ ] Прогнать configuration tests и весь `npm test`, получить независимый review конфигурационных изменений.

**Gate:** никакого fallback/redirect/запроса в production; собственные ключи; реальные Deno imports/PDF fonts работают; локальная регрессия PASS.

## Этап 4. DNS, TLS и тестовые accounts

- [ ] До DNS-действия проверить выбранный новый VPS и остановиться с одной точной инструкцией. Добавить только новые staging A records к новому IP; не менять app/auth/root/MX записи. Убедиться, что нет конфликтующего AAAA для новых names.
- [ ] Получить TLS на отдельном сервере, проверить Caddy virtual hosts и REST/Auth/Storage/Functions routing. Закрыть Mailpit UI/Studio за tunnel или отдельной аутентификацией, API health не раскрывает конфигурацию. Добавить staging banner и noindex.
- [ ] Создать synthetic specialists A/B, parents A/B/C, минимум два ребёнка для одного родителя и отдельного ребёнка второго специалиста. Данные: Артём Смирнов, Анна Смирнова, fictional DOB; email только уникальные `@example.invalid`. Реальных людей не приглашать.
- [ ] Проверить новый и существующий invitation flow через реальные Edge и Auth, resend/revoke, wrong-email, expiry, legal consent. Письма получить в закрытом sink, перейти по ссылкам через браузер; recovery/reset проверять без ручного обхода email/consent flow.

**Gate:** изоляция сессий, parent roles ровно parent, специалистские roles корректны, ссылки/шаблоны работают на staging, наружных писем нет. Внешняя SMTP deliverability остаётся непроверенной и не блокирует isolated checks; перед production требуется отдельный согласованный безопасный тест.

## Этап 5. Реальные security/runtime и UI проверки

- [ ] Запустить существующий `ops/security/test-parent-portal-rls.mjs` с secure server env и точными `FIZIRA_PARENT_PORTAL_E2E_CONFIRM=synthetic-parent-portal-test`, `FIZIRA_PARENT_PORTAL_TARGET=isolated-disposable`; не менять production denylist. Сохранить обезличенный PASS/FAIL и SHA/version binding.
- [ ] Дополнить реальные multi-connection проверки create/resend/accept и publication claim/retry/archive. SQL verifier PASS не подменяет эти проверки.
- [ ] Проверить actual Storage read/sign/write/upsert/delete/copy/move и настроенный S3 interface: cross-account IDOR, own-prefix parent denial, source locks, ETag/version/byte order, immutability published/archived photo/PDF, late file URL responses и revoke. Не считать metadata-only отказ доказательством неизменности bytes.
- [ ] В браузере desktop/mobile: parent registration/login/consent, home/schedule/reports/photos/PDF/goals/dynamics, два ребёнка, пустые/ошибочные состояния, logout/login другого parent, repeated auth event, unsaved form и delayed API/file response. Для email tokens/passwords не снимать скриншоты и не публиковать HAR без очистки.
- [ ] Специалист: создание/редактирование fictional patient, contacts/invite/revoke, draft/publish/retry/archive, schedule и layout. Проверить parent CSS regression в computed layout обеих страниц.
- [ ] Cleanup runner проверить на ошибки. Не удалять immutable consent/reservation evidence обходом триггеров: полная очистка — последующее удаление отдельного стенда. Сохраняемые browser fixture данные отделить от удаляемых runner fixtures.

**Gate:** все обязательные runtime сценарии PASS; несоответствие owner/version или bytes — blocker, исправление и повторная проверка.

## Этап 6. Независимый runtime review и дальнейшее решение

- [ ] Отдельный reviewer, не автор staging/config fixes: security, authorization/IDOR, account/child isolation, Storage/S3, immutable semantics, async, UI и specialist regression, migrations и evidence completeness.
- [ ] Все High/Important/Blocker вернуть implementer, закрыть тестами и независимым re-review; непроверенные runtime ветки явно обозначить.
- [ ] Подготовить итог: staging ID, exact code/platform SHAs, конфигурационные hashes без секретов, результаты, remaining limits, расходы и возможность удаления стенда.
- [ ] Только после PASS предложить план merge/backend/frontend release. Production parity, его backup/restore, внешнее SMTP и отдельное пользовательское разрешение остаются будущими gates. Этот план не разрешает production доступ или deployment.

## Текущая точка остановки

Исследование и план готовы; ни сервер, ни DNS, ни аккаунты пока не созданы. Первый ручной шаг: открыть Timeweb Cloud → «Облачные серверы» → «Создать» / «Добавить», остановиться на форме. Ничего не оплачивать и не переустанавливать существующий сервер. После наблюдения формы дать одно следующее действие.
