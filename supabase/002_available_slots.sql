-- Функция: свободные слоты на дату
-- Учитывает длительность услуги — не показывает слот, если услуга не помещается
-- Вызов: SELECT * FROM get_available_slots('anna_ivanova_3102', '2026-03-15', 90);

CREATE OR REPLACE FUNCTION get_available_slots(
  master_slug TEXT,
  target_date DATE,
  service_duration_min INT DEFAULT 30
)
RETURNS TABLE(time_slot TIME) AS $$
DECLARE
  v_master_id UUID;
  v_day_of_week INT;
  v_start TIME;
  v_end TIME;
  v_slot_dur INT;
  v_is_working BOOLEAN;
  v_current TIME;
  v_service_end TIME;
BEGIN
  -- Находим мастера
  SELECT id INTO v_master_id FROM masters WHERE slug = master_slug;
  IF v_master_id IS NULL THEN RETURN; END IF;

  -- День недели (0=Вс, 1=Пн...6=Сб)
  v_day_of_week := EXTRACT(DOW FROM target_date)::INT;

  -- Расписание на этот день
  SELECT start_time, end_time, slot_duration, is_working
    INTO v_start, v_end, v_slot_dur, v_is_working
    FROM schedule
    WHERE schedule.master_id = v_master_id AND schedule.day_of_week = v_day_of_week;

  -- Выходной или нет расписания
  IF v_is_working IS NULL OR v_is_working = false THEN RETURN; END IF;

  -- Генерируем слоты и проверяем каждый
  v_current := v_start;
  WHILE v_current < v_end LOOP
    -- Конец услуги, если начать в v_current
    v_service_end := v_current + (service_duration_min || ' minutes')::INTERVAL;

    -- Услуга должна помещаться до конца рабочего дня
    IF v_service_end <= v_end THEN
      -- Проверяем, не пересекается ли [v_current, v_service_end) с какой-либо записью
      IF NOT EXISTS (
        SELECT 1 FROM bookings b
        WHERE b.master_id = v_master_id
          AND b.date = target_date
          AND b.status != 'cancelled'
          AND v_current < b.end_time
          AND v_service_end > b.time
      ) THEN
        time_slot := v_current;
        RETURN NEXT;
      END IF;
    END IF;

    v_current := v_current + (v_slot_dur || ' minutes')::INTERVAL;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
