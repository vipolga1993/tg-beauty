// Vercel Serverless Function: создание записи
// POST /api/book

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const data = req.body;

    // Валидация
    if (!data.slug || !data.serviceId || !data.date || !data.time) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
    const BOT_TOKEN = process.env.BOT_TOKEN;

    const headers = {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
    };

    // 1. Находим мастера
    const masterRes = await fetch(
      `${SUPABASE_URL}/rest/v1/masters?slug=eq.${data.slug}&limit=1`,
      { headers }
    );
    const masters = await masterRes.json();
    if (!masters || masters.length === 0) {
      return res.status(404).json({ error: 'Master not found' });
    }
    const master = masters[0];

    // Проверка trial
    if (master.plan !== 'pro' && master.plan_expires) {
      if (new Date(master.plan_expires) < new Date()) {
        return res.status(403).json({ error: 'Trial expired' });
      }
    }

    // 2. Проверяем, что слот не занят (защита от race condition)
    const slotCheck = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?master_id=eq.${master.id}&date=eq.${data.date}&time=eq.${data.time}&status=neq.cancelled&limit=1`,
      { headers }
    );
    if (slotCheck.ok) {
      const existing = await slotCheck.json();
      if (existing && existing.length > 0) {
        return res.status(409).json({ error: 'Slot already booked' });
      }
    }

    // 2b. Валидируем промокод на backend (если передан)
    let validatedDiscount = 0;
    if (data.promoCode) {
      const promoRes = await fetch(
        `${SUPABASE_URL}/rest/v1/promo_codes?master_id=eq.${master.id}&promo_code=eq.${encodeURIComponent(data.promoCode)}&is_active=eq.true&limit=1`,
        { headers }
      );
      if (promoRes.ok) {
        const promos = await promoRes.json();
        if (promos && promos.length > 0) {
          validatedDiscount = promos[0].discount_percent || 0;
        }
      }
      // Если промокод не найден — игнорируем скидку
    }

    // 3. Вычисляем end_time
    const [hours, minutes] = data.time.split(':').map(Number);
    const duration = Number(data.duration) || 60;
    const endMinutes = hours * 60 + minutes + duration;
    const endTime = String(Math.floor(endMinutes / 60)).padStart(2, '0') + ':' +
                    String(endMinutes % 60).padStart(2, '0');

    // 4. Вычисляем финальную цену с проверенной скидкой
    const originalPrice = Number(data.price) || null;
    const finalPrice = originalPrice && validatedDiscount > 0
      ? Math.round(originalPrice * (1 - validatedDiscount / 100))
      : originalPrice;

    // 5. Сохраняем запись в БД
    const bookingRes = await fetch(`${SUPABASE_URL}/rest/v1/bookings`, {
      method: 'POST',
      headers: { ...headers, 'Prefer': 'return=representation' },
      body: JSON.stringify({
        master_id: master.id,
        service_id: data.serviceId,
        client_tg_id: data.userId || 0,
        client_name: data.userName || 'Клиент',
        client_username: data.userUsername || null,
        date: data.date,
        time: data.time,
        end_time: endTime,
        status: 'pending',
        promo_code: data.promoCode || null,
        discount_percent: validatedDiscount,
        final_price: finalPrice,
      }),
    });

    if (!bookingRes.ok) {
      const err = await bookingRes.json();
      console.error('Booking insert error:', err);
      return res.status(500).json({ error: 'Failed to create booking' });
    }

    const bookings = await bookingRes.json();
    const booking = bookings[0];

    // 4. Уведомляем мастера через Telegram Bot API
    const confirmKeyboard = {
      inline_keyboard: [[
        { text: '✅ Подтвердить', callback_data: `booking_confirm_${booking.id}` },
        { text: '❌ Отменить', callback_data: `booking_cancel_${booking.id}` },
      ]],
    };

    const priceText = data.price ? (Number(data.price).toLocaleString('ru-RU') + ' ₽') : '';
    const promoText = data.promoCode ? ('\n🏷 Промокод: ' + data.promoCode + ' (−' + data.discountPercent + '%)') : '';

    const notifyLines = [
      '📥 Новая запись!',
      '',
      '👤 ' + (data.userName || 'Клиент') + (data.userUsername ? ' (@' + data.userUsername + ')' : ''),
      (data.serviceName || 'Услуга'),
      '📅 ' + data.date + ' в ' + data.time + '–' + endTime,
      '💰 ' + priceText + promoText,
    ];

    const masterNotifyRes = await fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: master.telegram_id,
        text: notifyLines.join('\n'),
        reply_markup: confirmKeyboard,
      }),
    });

    const masterNotifyResult = await masterNotifyRes.json();
    console.log('Master notify result:', JSON.stringify(masterNotifyResult));

    // 5. Уведомляем клиента (если есть tg_id)
    if (data.userId) {
      const clientLines = [
        '\u2705 \u0417\u0430\u043f\u0438\u0441\u044c \u0441\u043e\u0437\u0434\u0430\u043d\u0430!',
        '',
        (data.serviceName || '\u0423\u0441\u043b\u0443\u0433\u0430'),
        '\ud83d\udcc5 ' + data.date + ' \u0432 ' + data.time,
        '\ud83d\udcb0 ' + priceText,
        master.address ? ('\ud83d\udccd ' + master.address) : '',
        '',
        '\u041c\u0430\u0441\u0442\u0435\u0440: ' + master.name,
        '',
        '\u231b \u041e\u0436\u0438\u0434\u0430\u0439\u0442\u0435 \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0438\u044f \u043e\u0442 \u043c\u0430\u0441\u0442\u0435\u0440\u0430.',
      ];

      await fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: data.userId,
          text: clientLines.filter(Boolean).join('\n'),
        }),
      });
    }

    return res.status(200).json({ ok: true, bookingId: booking.id });

  } catch (err) {
    console.error('Book API error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
