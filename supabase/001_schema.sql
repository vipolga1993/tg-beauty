-- =============================================
-- Telegram Beauty SaaS — Схема базы данных
-- Запускать в Supabase SQL Editor
-- =============================================

-- 1. МАСТЕРА — главная таблица, «хозяева» своих страниц
-- Представь, что это «профиль в Instagram»: имя, аватар, описание, адрес
CREATE TABLE masters (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id   BIGINT UNIQUE NOT NULL,       -- ID мастера в Telegram (число)
  username      TEXT,                          -- @username в Telegram
  slug          TEXT UNIQUE NOT NULL,          -- Короткое имя для ссылки: "anna123"
  name          TEXT NOT NULL,                 -- Отображаемое имя: "Анна Иванова"
  avatar_url    TEXT,                          -- Ссылка на фото профиля
  speciality    TEXT,                          -- "Маникюр, Педикюр"
  experience    TEXT,                          -- "5 лет"
  address       TEXT,                          -- "ул. Тверская, 15, оф 3"
  phone         TEXT,                          -- Телефон (необязательно)

  -- Настройки внешнего вида (только для PRO)
  theme         JSONB DEFAULT '{}',           -- {"accent": "#ff6b9d", "style": "rounded"}

  -- Подписка
  plan          TEXT DEFAULT 'free' CHECK (plan IN ('free', 'pro')),
  plan_expires  TIMESTAMPTZ,                  -- Когда заканчивается PRO

  -- Счётчик записей
  total_bookings INT DEFAULT 0,

  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- 2. УСЛУГИ — то, что мастер предлагает клиентам
-- Как «товары в магазине»: название, цена, сколько длится
CREATE TABLE services (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  master_id   UUID NOT NULL REFERENCES masters(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,                   -- "Маникюр классический"
  description TEXT,                            -- Подробное описание
  price       INT NOT NULL CHECK (price >= 0), -- Цена в рублях
  duration    INT NOT NULL CHECK (duration > 0), -- Длительность в минутах
  emoji       TEXT DEFAULT '💅',               -- Эмодзи для карточки
  sort_order  INT DEFAULT 0,                   -- Порядок в списке
  is_active   BOOLEAN DEFAULT true,            -- Можно скрыть, не удаляя

  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Индекс: быстро находим услуги конкретного мастера
CREATE INDEX idx_services_master ON services(master_id) WHERE is_active = true;

-- 3. ПОРТФОЛИО — фото работ мастера
-- Как «галерея в Instagram»: фото результатов работы
CREATE TABLE portfolio (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  master_id   UUID NOT NULL REFERENCES masters(id) ON DELETE CASCADE,
  image_url   TEXT NOT NULL,                   -- Ссылка на фото в Supabase Storage
  caption     TEXT,                            -- Подпись (необязательно)
  sort_order  INT DEFAULT 0,

  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_portfolio_master ON portfolio(master_id);

-- 4. РАСПИСАНИЕ — рабочие часы мастера
-- Как «табличка на двери»: когда открыто, когда закрыто
CREATE TABLE schedule (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  master_id     UUID NOT NULL REFERENCES masters(id) ON DELETE CASCADE,
  day_of_week   INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Вс, 1=Пн...6=Сб
  start_time    TIME NOT NULL,                 -- "10:00"
  end_time      TIME NOT NULL,                 -- "18:00"
  slot_duration INT DEFAULT 30,                -- Шаг в минутах (30 мин по умолчанию)
  is_working    BOOLEAN DEFAULT true,          -- Рабочий ли этот день

  UNIQUE(master_id, day_of_week)              -- Один мастер — одна строка на день
);

CREATE INDEX idx_schedule_master ON schedule(master_id);

-- 5. ЗАПИСИ КЛИЕНТОВ — кто, когда, на что записался
-- Как «журнал записей в тетрадке у мастера»
CREATE TABLE bookings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  master_id       UUID NOT NULL REFERENCES masters(id),
  service_id      UUID NOT NULL REFERENCES services(id),

  -- Данные клиента (берём из Telegram автоматически)
  client_tg_id    BIGINT NOT NULL,             -- Telegram ID клиента
  client_name     TEXT NOT NULL,               -- Имя из Telegram
  client_username TEXT,                        -- @username клиента

  -- Когда
  date            DATE NOT NULL,               -- Дата записи
  time            TIME NOT NULL,               -- Время начала
  end_time        TIME NOT NULL,               -- Время окончания (автовычисление)

  -- Статус записи
  status          TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed')),

  -- Напоминания (PRO-фича)
  reminder_24h    BOOLEAN DEFAULT false,       -- Отправлено ли напоминание за 24ч
  reminder_2h     BOOLEAN DEFAULT false,       -- Отправлено ли напоминание за 2ч

  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Индексы: быстро ищем записи мастера и проверяем пересечения
CREATE INDEX idx_bookings_master_date ON bookings(master_id, date) WHERE status != 'cancelled';
CREATE INDEX idx_bookings_client ON bookings(client_tg_id);
CREATE INDEX idx_bookings_reminders ON bookings(date, status)
  WHERE status = 'confirmed' AND (reminder_24h = false OR reminder_2h = false);

-- 6. ПЛАТЕЖИ — история оплат подписок
-- Как «чеки из магазина»: кто заплатил, сколько, когда
CREATE TABLE payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  master_id       UUID NOT NULL REFERENCES masters(id),
  amount_stars    INT NOT NULL,                -- Сумма в Telegram Stars
  period          TEXT NOT NULL CHECK (period IN ('month', 'year')),
  status          TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'refunded')),
  tg_payment_id   TEXT,                        -- ID транзакции от Telegram

  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_payments_master ON payments(master_id);


-- =============================================
-- АВТОМАТИЧЕСКОЕ ОБНОВЛЕНИЕ updated_at
-- =============================================
-- Это как «дата последнего изменения» в документе —
-- каждый раз когда мастер что-то меняет в профиле, дата обновляется автоматически

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER masters_updated_at
  BEFORE UPDATE ON masters
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- =============================================
-- ЗАПОЛНЕНИЕ РАСПИСАНИЯ ПО УМОЛЧАНИЮ
-- =============================================
-- Когда мастер регистрируется, автоматически создаём ему
-- расписание Пн-Сб 10:00–18:00, Вс — выходной.
-- Как «шаблон рабочей недели» — потом можно изменить.

CREATE OR REPLACE FUNCTION create_default_schedule()
RETURNS TRIGGER AS $$
BEGIN
  -- Понедельник — Суббота: рабочие дни 10:00–18:00
  INSERT INTO schedule (master_id, day_of_week, start_time, end_time, is_working)
  VALUES
    (NEW.id, 1, '10:00', '18:00', true),  -- Пн
    (NEW.id, 2, '10:00', '18:00', true),  -- Вт
    (NEW.id, 3, '10:00', '18:00', true),  -- Ср
    (NEW.id, 4, '10:00', '18:00', true),  -- Чт
    (NEW.id, 5, '10:00', '18:00', true),  -- Пт
    (NEW.id, 6, '10:00', '18:00', true),  -- Сб
    (NEW.id, 0, '10:00', '18:00', false); -- Вс — выходной
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER masters_default_schedule
  AFTER INSERT ON masters
  FOR EACH ROW EXECUTE FUNCTION create_default_schedule();


-- =============================================
-- ROW LEVEL SECURITY (RLS) — ПРАВА ДОСТУПА
-- =============================================
-- RLS — это как «замок на двери». Даже если кто-то знает адрес
-- (URL таблицы), он увидит только то, что ему разрешено.
--
-- Supabase работает так:
-- - anon key   = незалогиненный пользователь (клиент в Mini App)
-- - service key = наш бэкенд (бот, API) — полный доступ
--
-- Мы используем service key в API, поэтому RLS не блокирует наш бэкенд.
-- Но RLS защищает от прямого доступа к БД через anon key.

ALTER TABLE masters ENABLE ROW LEVEL SECURITY;
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

-- Публичное чтение: любой может видеть профили мастеров и их услуги
-- (это как витрина магазина — видна всем)
CREATE POLICY "masters_public_read" ON masters
  FOR SELECT USING (true);

CREATE POLICY "services_public_read" ON services
  FOR SELECT USING (is_active = true);

CREATE POLICY "portfolio_public_read" ON portfolio
  FOR SELECT USING (true);

CREATE POLICY "schedule_public_read" ON schedule
  FOR SELECT USING (true);

-- Записи и платежи — только через service key (наш API)
-- Никто не может читать чужие записи напрямую
CREATE POLICY "bookings_service_only" ON bookings
  FOR ALL USING (false);

CREATE POLICY "payments_service_only" ON payments
  FOR ALL USING (false);

-- Запись данных во все таблицы — только через service key
-- (мастер редактирует через API, который проверяет initData)
CREATE POLICY "masters_service_write" ON masters
  FOR INSERT WITH CHECK (false);
CREATE POLICY "masters_service_update" ON masters
  FOR UPDATE USING (false);

CREATE POLICY "services_service_write" ON services
  FOR INSERT WITH CHECK (false);
CREATE POLICY "services_service_update" ON services
  FOR UPDATE USING (false);
CREATE POLICY "services_service_delete" ON services
  FOR DELETE USING (false);

CREATE POLICY "portfolio_service_write" ON portfolio
  FOR INSERT WITH CHECK (false);
CREATE POLICY "portfolio_service_delete" ON portfolio
  FOR DELETE USING (false);

CREATE POLICY "schedule_service_write" ON schedule
  FOR UPDATE USING (false);


-- =============================================
-- ПОЛЕЗНЫЕ VIEWS (готовые «отчёты»)
-- =============================================

-- Активные услуги мастера с лимитом для бесплатного тарифа
CREATE OR REPLACE VIEW master_services_with_limit AS
SELECT
  s.*,
  m.plan,
  COUNT(*) OVER (PARTITION BY s.master_id) AS total_active_services,
  CASE
    WHEN m.plan = 'free' AND COUNT(*) OVER (PARTITION BY s.master_id ORDER BY s.created_at) > 5
    THEN true
    ELSE false
  END AS over_free_limit
FROM services s
JOIN masters m ON m.id = s.master_id
WHERE s.is_active = true;

-- Записи на сегодня для дашборда мастера
CREATE OR REPLACE VIEW today_bookings AS
SELECT
  b.*,
  s.name AS service_name,
  s.emoji AS service_emoji,
  s.price AS service_price
FROM bookings b
JOIN services s ON s.id = b.service_id
WHERE b.date = CURRENT_DATE
  AND b.status != 'cancelled'
ORDER BY b.time;
