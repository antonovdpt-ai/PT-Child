# PT Child MVP v0.4

Первый рабочий прототип с локальным сохранением данных в браузере.

## Что уже работает
- список пациентов;
- создание тестовой карточки ребёнка;
- карточка ребёнка;
- сохранение первичной оценки;
- добавление и удаление функциональных целей;
- добавление и удаление записей занятий;
- динамика по целям;
- данные сохраняются через localStorage после закрытия/перезагрузки страницы.

## Важно
Это только техническое демо. Не используйте реальные данные пациентов.

localStorage:
- не является медицинской защищённой базой;
- не имеет авторизации;
- не имеет серверного резервного копирования;
- данные привязаны к конкретному браузеру/устройству.

## Как запустить
### Вариант 1 — GitHub Pages
Загрузить все файлы в репозиторий и включить GitHub Pages для ветки main.

### Вариант 2 — локально на компьютере
Открыть index.html в современном браузере.

## Следующий этап
- полноценные детализированные поля первичной оценки;
- голосовой ввод;
- AI-черновики;
- домашние программы;
- документы;
- авторизация;
- серверная база данных;
- роли специалист/родитель;
- юридическая и техническая архитектура для медицинских данных.

## Parent portal

`parent.html`/`parent.js` provide the parent UI; `parent-domain.mjs` formats safe
projections and `role-gate.mjs` handles role routing. `parent-specialist.js` adds
specialist invitations, drafts, explicit publication and archive controls.
Clinical source tables remain specialist-only. Narrow security-definer parent
RPCs expose linked, published data; checked Edge Functions manage invitations and
serve immutable server-generated PDF/photo artifacts through short signed URLs.
Database migrations008–012 and separate Edge/runtime verification must precede
frontend activation. See [the rollout and rollback runbook](ops/parent-portal/README.md)
for the isolated synthetic security gate, complete release evidence and manual
acceptance checks. `npm test` includes all local security, release and shared tests.
