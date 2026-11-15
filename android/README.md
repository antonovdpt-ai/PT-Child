# Fizira Android / RuStore

Android-приложение открывает существующую PWA Fizira через **Trusted Web Activity**
(Android Browser Helper), не копируя клинические данные в нативный APK.
Стартовый адрес: `https://app.fizira.com/`.

**Статус:** исходный Android-проект и тестовая debug-сборка. Не публиковать
debug APK в RuStore. Публикация возможна только после финальной подписи,
Digital Asset Links, реальных Android-тестов и модерации.

## Сборка на Android SDK / JDK 17 / Gradle 8.13

```bash
python3 -m pip install Pillow==12.0.0
python3 android/tools/generate-icons.py
python3 android/tools/verify-release.py
gradle -p android :app:assembleDebug --no-daemon
```

Для релизной сборки сохраняйте **личный постоянный** keystore офлайн
и заполняйте файл `android/release-signing.properties`:

```properties
storeFile=/ABSOLUTE/PATH/TO/fizira-release.keystore
storePassword=...
keyAlias=...
keyPassword=...
```

Он исключён из git. Затем:

```bash
gradle -p android :app:assembleRelease --no-daemon
```

**Никогда не присылайте keystore или его пароль в чат и не коммитьте в GitHub.**
Нужна резервная копия, иначе следующие обновления с тем же package ID не подпишутся.

## Связь Android-подписи с доменом

После получения SHA-256 сертификата релизного ключа разместить на сервере
`https://app.fizira.com/.well-known/assetlinks.json` с содержимым:

```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "com.fizira.app",
    "sha256_cert_fingerprints": ["ФАКТИЧЕСКИЙ_SHA256_СЕРТИФИКАТА"]
  }
}]
```

Без этого TWA может открыться как вкладка браузера с адресной строкой.
Если RuStore переподписывает APK, проверить сертификат именно установленного
приложения и обновить assetlinks.json. Любой выпуск связывать с фактическим ключом.

## Перед отправкой на модерацию

- Проверить доступность Fizira из России и на Chrome/Edge/Samsung Internet.
  Без поддерживающего TWA браузера возможен запуск через Custom Tab.
- Проверить вход, перезапуск, выход, восстановление пароля, загрузку файлов,
  расписание, карточку ребёнка, родительский кабинет, потерю сети.
- Проверить, что в реальном приложении **нет предупреждения о тестовой версии с
  фиктивными пациентами**, если заявляем коммерческую доступность.
- Разместить действующую политику данных, удалить демонстрационные данные
  из реальных публичных экранов. Для модерации предоставить тестовую учётную запись.
- Сделать минимум **три настоящих скриншота** интерфейса без данных реальных детей.
- Заполнить декларации конфиденциальности, возраст, категорию, контакты.
- Учесть, что RuStore может отклонить приложение, дублирующее сайт без
  самостоятельной мобильной ценности; TWA не гарантирует публикации.
- Подтвердить, что `com.fizira.app` свободен в RuStore.
- Зарегистрировать кабинет разработчика RuStore как ИП с действующей УКЭП.

См. [описание для магазина](store-listing-ru.md).

Официальные ссылки:
- https://www.rustore.ru/help/developers/publishing-and-verifying-apps/app-publication
- https://www.rustore.ru/help/users/start/installation-promotion-and-publication
- https://www.rustore.ru/help/developers/developer-account/registration-developer/registration
- https://github.com/GoogleChrome/android-browser-helper
