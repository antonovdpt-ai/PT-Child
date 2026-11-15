# Fizira: Android / RuStore — подготовка

**Статус: APK/AAB пока не собран и не опубликован.** Не путать подготовленную PWA с нативной Android-сборкой.

## Подход

Для первой проверки Android-версии рассмотрена Trusted Web Activity (TWA) с Bubblewrap. TWA открывает собственный HTTPS-сайт полноэкранно после проверки Digital Asset Links, а не превращает веб-код в нативный. RuStore отдельно проверяет самостоятельную ценность приложения: одного сайта в оболочке и офлайн-страницы может быть недостаточно. Нужно обеспечить значимый мобильный сценарий (например, нативные напоминания о занятиях) и проверить это на модерации.

## Порядок

1. Влить PWA PR после тестов и выполнить **ручной** деплой на app.fizira.com.
2. Проверить PNG-иконки, вход, восстановление сессии, расписание, фото/файлы и родительский кабинет на Android. Не использовать реальные данные детей в тестах.
3. Определить уникальный `applicationId`, кандидат: `com.fizira.app` (проверить, что он свободен).
4. Создать отдельный ключ подписи приложения и сохранить его вне репозитория. Никогда не коммитить пароли или `.keystore`.
5. После настройки Android SDK, Java и Node.js выполнить:

```sh
npm install -g @bubblewrap/cli
mkdir fizira-android && cd fizira-android
bubblewrap init --manifest=https://app.fizira.com/manifest.webmanifest
bubblewrap build
```

6. Получить SHA-256 отпечаток **сертификата, которым подписана устанавливаемая версия**. Разместить файл `https://app.fizira.com/.well-known/assetlinks.json`, заменив реальные значения:

```json
[{"relation":["delegate_permission/common.handle_all_urls"],"target":{"namespace":"android_app","package_name":"com.fizira.app","sha256_cert_fingerprints":["<REAL_CERT_SHA256_FINGERPRINT>"]}}]
```

7. Проверить, что TWA открывается без браузерной панели, и протестировать отсутствие сети, камеру, доступ к файлам и аутентификацию.
8. Зарегистрировать аккаунт ИП в [RuStore Консоль](https://console.rustore.ru/) (официальные правила требуют КЭП для ИП), загрузить подписанный APK или AAB, карточку, скриншоты, возрастную классификацию, политику конфиденциальности и тестовый доступ. Направить на модерацию.

Публикация в RuStore бесплатна, но подача и одобрение не автоматические.
Официальные материалы: https://www.rustore.ru/help/developers/publishing-and-verifying-apps/app-publication , https://www.rustore.ru/help/users/start/installation-promotion-and-publication , https://developer.chrome.com/docs/android/trusted-web-activity/quick-start/
