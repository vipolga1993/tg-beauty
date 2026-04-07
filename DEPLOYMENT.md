# DEPLOYMENT.md — Руководство по деплою tg-beauty

## Статус деплоя

| Компонент | Платформа | Статус | URL |
|-----------|-----------|--------|-----|
| Mini App (фронтенд) | Vercel | ✅ В продакшне | https://tg-app-tan.vercel.app |
| База данных | Supabase | ✅ Подключена | pppxffhrgbzokjvnevme.supabase.co |
| Бот | Railway | ✅ В продакшне | tg-beauty-bot (long polling) |

---

## 1. Фронтенд — Vercel

### Первый деплой

```bash
# 1. Установить Vercel CLI
npm install -g vercel

# 2. Из папки tg-app/
cd tg-app
vercel

# Ответить на вопросы:
# - Project name: tg-beauty
# - Which directory: ./ (текущая)
# - Override settings: No
```

### Обновление (повторный деплой)

```bash
cd tg-app
vercel --prod
```

### Настройка домена в Vercel

1. Открыть https://vercel.com → проект `tg-beauty`
2. Settings → Domains → добавить домен
3. Обновить URL в настройках бота Telegram

---

## 2. База данных — Supabase

### Применение миграций

Миграции хранятся в `supabase/`:

```bash
# Применять в порядке нумерации:
# 1. supabase/001_schema.sql       — основные таблицы
# 2. supabase/002_available_slots.sql — функция слотов
# 3. supabase/003_bot_sessions.sql — сессии бота
```

**Как применить:**

1. Открыть https://supabase.com → проект → SQL Editor
2. Скопировать содержимое файла и выполнить
3. Проверить: таблицы появились в Database → Tables

### Проверка подключения

```bash
cd /путь/к/tg-beauty
node test-db.cjs
```

Ожидаемый результат — все 7 пунктов `OK`.

### Переменные окружения Supabase

Хранятся в `.env`:

```
SUPABASE_URL=https://....supabase.co
SUPABASE_SERVICE_KEY=sb_secret_...
SUPABASE_ANON_KEY=eyJ...
```

**Где взять ключи:** Supabase Dashboard → Settings → API

---

## 3. Бот — деплой

### Вариант A: Railway (рекомендуется)

```bash
# 1. Установить Railway CLI
npm install -g @railway/cli

# 2. Войти
railway login

# 3. Создать проект
cd bot
railway init

# 4. Добавить переменные окружения в Railway Dashboard:
#    BOT_TOKEN=...
#    SUPABASE_URL=...
#    SUPABASE_SERVICE_KEY=...

# 5. Задеплоить
railway up
```

### Вариант B: VPS (ручной деплой)

```bash
# На сервере:
git clone <repo-url>
cd tg-beauty/bot
npm install
cp .env.example .env  # заполнить переменные

# Запустить через pm2:
npm install -g pm2
pm2 start src/index.js --name tg-beauty-bot
pm2 save
pm2 startup
```

### Вариант C: Локально (для разработки)

```bash
cd bot
npm install
npm run dev
```

---

## 4. Переменные окружения

### .env (локально)

```env
# Telegram
BOT_TOKEN=your_bot_token_here

# Supabase
SUPABASE_URL=https://....supabase.co
SUPABASE_SERVICE_KEY=sb_secret_...
SUPABASE_ANON_KEY=eyJ...

# Mini App
MINI_APP_URL=https://tg-app-tan.vercel.app
```

### Где брать значения

| Переменная | Где взять |
|------------|-----------|
| `BOT_TOKEN` | @BotFather в Telegram |
| `SUPABASE_URL` | Supabase → Settings → API → Project URL |
| `SUPABASE_SERVICE_KEY` | Supabase → Settings → API → service_role key |
| `SUPABASE_ANON_KEY` | Supabase → Settings → API → anon key |
| `MINI_APP_URL` | Vercel → проект → домен |

---

## 5. Чеклист перед продакшном

- [ ] `.env` заполнен всеми ключами
- [ ] `node test-db.cjs` — все проверки OK
- [ ] Mini App открывается на https://tg-app-tan.vercel.app
- [ ] Бот отвечает на `/start`
- [ ] Deep link работает: `t.me/tg_beautybot?start=m_slug`
- [ ] Mini App открывается из Telegram (не только в браузере)

---

## 6. Архитектура продакшна

```
Пользователь
    │
    ▼
Telegram → @tg_beautybot (bot/)
               │
               ├── Регистрация мастера
               ├── Уведомления о записях
               └── Открывает Mini App ──→ Vercel (tg-app/)
                                               │
                                               ▼
                                          Supabase (БД)
                                          masters, services,
                                          bookings, schedule
```
