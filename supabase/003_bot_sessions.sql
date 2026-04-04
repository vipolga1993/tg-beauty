-- Таблица для хранения состояния бота (регистрация мастера и т.д.)
-- Serverless функции не хранят состояние между вызовами,
-- поэтому храним шаги регистрации в БД.

CREATE TABLE IF NOT EXISTS bot_sessions (
  telegram_id  BIGINT PRIMARY KEY,
  data         JSONB DEFAULT '{}',
  updated_at   TIMESTAMPTZ DEFAULT now()
);

-- RLS: доступ только через service key
ALTER TABLE bot_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bot_sessions_service_only" ON bot_sessions
  FOR ALL USING (false);
