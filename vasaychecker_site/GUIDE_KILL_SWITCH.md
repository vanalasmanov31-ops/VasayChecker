# Гайд: remote kill-switch для VasayChecker

## Что должно получиться
- Файл `status.json` на GitHub управляет сайтом и методами расширения.
- `checker_site: false` → на https://vanalasmanov31-ops.github.io/VasayChecker/ полноэкранное окно «Site unavailable» + причина.
- Работает **у всех** (скрипт вшит в `index.html` сайта), не только у тех, у кого стоит расширение.

---

## Шаг 1. Репозиторий статуса

1. Открой (или создай) репозиторий: **vanalasmanov31-ops/vasay-status** (Public).
2. В корень положи файл **status.json**:

```json
{
  "instant": true,
  "studio120": true,
  "checker_site": true,
  "message": "",
  "updated": "2026-10-10T00:00:00Z"
}
```

3. Commit.
4. Проверь raw-ссылку в браузере:
   `https://raw.githubusercontent.com/vanalasmanov31-ops/vasay-status/refs/heads/main/status.json`
   Должен открыться JSON. Если 404 — неверный путь/ветка (main vs master).

---

## Шаг 2. Обновить сам сайт VasayChecker

1. Репозиторий **vanalasmanov31-ops/VasayChecker** (тот, откуда GitHub Pages).
2. Залей обновлённый **index.html** из архива (в него уже встроен gate-скрипт).
3. Остальные файлы сайта можно залить как были: `noblur.js`, `logger.html`, `*.py` и т.д.
4. Pages: Settings → Pages → Deploy from branch **main** / root (или docs — как у тебя сейчас).
5. Подожди 1–2 минуты, обнови сайт с hard refresh (Ctrl+Shift+R).

---

## Шаг 3. Выключить сайт

### Вариант A — через killswitch.html
1. Открой `killswitch.html` локально или с Pages.
2. В поле URL уже должен быть raw status.json.
3. В «Сообщение» напиши причину, например: `Техработы до 18:00 UTC`.
4. Нажми **«Выключить сайт VasayChecker»** → скачается `status.json`.
5. В репо **vasay-status** замени файл → **Commit changes**.

### Вариант B — вручную
В `status.json` поставь:

```json
{
  "instant": true,
  "studio120": true,
  "checker_site": false,
  "message": "Техработы до 18:00 UTC. Следите за Telegram.",
  "updated": "2026-10-10T12:00:00Z"
}
```

Commit.

---

## Шаг 4. Проверка

1. Открой https://vanalasmanov31-ops.github.io/VasayChecker/
2. Через 0–20 сек должно быть **полноэкранное** окно:
   - заголовок Site unavailable
   - текст, что сайт выключен kill-switch
   - блок **Reason** с твоим `message`
3. Если не сработало:
   - raw status.json открывается? `checker_site` точно `false` (boolean, не строка `"false"`)?
   - в index.html есть скрипт с `vasay-site-lock`?
   - CORS: raw.githubusercontent.com отдаёт JSON без ошибки в Console (F12).

---

## Шаг 5. Включить сайт обратно

```json
"checker_site": true
```

или кнопка **«Включить сайт VasayChecker»** в killswitch.html → Commit.

Окно исчезнет после обновления страницы / следующей проверки (~20 с).

---

## Расширение (дополнительно)

Расширение vasay 1.16.6+ тоже читает тот же status.json:
- `instant` / `studio120` — методы
- `checker_site: false` — site-blocker.js дублирует fullscreen lock на github.io

Сайт блокируется **сам по себе** через index.html; расширение — запасной слой.

---

## Частые ошибки

| Проблема | Решение |
|----------|---------|
| 404 на raw | Ветка `main` vs `master`; путь `/status.json` |
| Сайт не гаснет | Не залит новый index.html с gate |
| `checker_site: "false"` | Нужен boolean `false` без кавычек |
| Репо Private | Сделай Public или raw не откроется без токена |
| Кэш Pages | Hard refresh, подожди деплой |
