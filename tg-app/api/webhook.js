// Vercel Serverless Function: Telegram Bot Webhook
// POST /api/webhook — full bot logic (commands, callbacks, registration)

const WEBAPP_URL = 'https://tg-app-tan.vercel.app';

export default async function handler(req, res) {
  // GET /api/webhook?cron=reminders&key=SECRET — cron-напоминания
  if (req.method === 'GET' && req.query.cron === 'reminders') {
    return await handleCronReminders(req, res);
  }

  if (req.method !== 'POST') return res.status(200).send('ok');

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const BOT_TOKEN = process.env.BOT_TOKEN;

  const db = createDb(SUPABASE_URL, SUPABASE_KEY);
  const tg = createTg(BOT_TOKEN);

  try {
    const update = req.body;

    // --- Callback Query ---
    if (update.callback_query) {
      return await handleCallback(update.callback_query, db, tg, res);
    }

    // --- Message ---
    if (update.message) {
      const msg = update.message;
      const text = msg.text || '';
      const chatId = msg.chat.id;
      const from = msg.from;

      // /start command
      if (text.startsWith('/start')) {
        const payload = text.replace('/start', '').trim();
        return await handleStart(chatId, from, payload, db, tg, res);
      }

      // /master command
      if (text === '/master') {
        return await handleMaster(chatId, from, db, tg, res);
      }

      // /reset command
      if (text === '/reset') {
        return await handleReset(chatId, from, db, tg, res);
      }

      // /help command
      if (text === '/help') {
        await tg.send(chatId, [
          '\u{1F4D6} \u041A\u043E\u043C\u0430\u043D\u0434\u044B \u0431\u043E\u0442\u0430:',
          '',
          '/start \u2014 \u043D\u0430\u0447\u0430\u0442\u044C \u0440\u0430\u0431\u043E\u0442\u0443',
          '/master \u2014 \u043F\u0430\u043D\u0435\u043B\u044C \u043C\u0430\u0441\u0442\u0435\u0440\u0430',
          '/help \u2014 \u044D\u0442\u0430 \u0441\u043F\u0440\u0430\u0432\u043A\u0430',
          '',
          '\u0414\u043B\u044F \u043C\u0430\u0441\u0442\u0435\u0440\u043E\u0432:',
          '1. \u0417\u0430\u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0438\u0440\u0443\u0439\u0442\u0435\u0441\u044C \u0447\u0435\u0440\u0435\u0437 /start',
          '2. \u0414\u043E\u0431\u0430\u0432\u044C\u0442\u0435 \u0443\u0441\u043B\u0443\u0433\u0438 \u0447\u0435\u0440\u0435\u0437 /master',
          '3. \u041E\u0442\u043F\u0440\u0430\u0432\u044C\u0442\u0435 \u0441\u0441\u044B\u043B\u043A\u0443 \u043A\u043B\u0438\u0435\u043D\u0442\u0430\u043C',
          '',
          '\u0414\u043B\u044F \u043A\u043B\u0438\u0435\u043D\u0442\u043E\u0432:',
          '\u041F\u0435\u0440\u0435\u0439\u0434\u0438\u0442\u0435 \u043F\u043E \u0441\u0441\u044B\u043B\u043A\u0435 \u043E\u0442 \u043C\u0430\u0441\u0442\u0435\u0440\u0430.',
        ].join('\n'));
        return res.status(200).send('ok');
      }

      // Text message — check if registration in progress
      if (text && !text.startsWith('/')) {
        return await handleText(chatId, from, text, db, tg, res);
      }
    }

    return res.status(200).send('ok');
  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(200).send('ok');
  }
}

// ===========================================
// /start
// ===========================================

async function handleStart(chatId, from, payload, db, tg, res) {
  // Deep link: /start m_<slug>
  if (payload.startsWith('m_')) {
    const slug = payload.slice(2);
    const master = await db.query('masters', 'slug=eq.' + slug + '&limit=1');

    if (!master) {
      await tg.send(chatId, '\u{1F614} \u041C\u0430\u0441\u0442\u0435\u0440 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D. \u041F\u0440\u043E\u0432\u0435\u0440\u044C\u0442\u0435 \u0441\u0441\u044B\u043B\u043A\u0443.');
      return res.status(200).send('ok');
    }

    // Save client→master link in bot_sessions
    await db.upsertSession(from.id, { linked_master_id: master.id, linked_slug: slug });

    const lines = [
      '\u{1F485} ' + master.name,
      master.speciality || '',
      master.address ? ('\u{1F4CD} ' + master.address) : '',
      '',
      '\u041D\u0430\u0436\u043C\u0438\u0442\u0435 \u043A\u043D\u043E\u043F\u043A\u0443 \u043D\u0438\u0436\u0435, \u0447\u0442\u043E\u0431\u044B \u0437\u0430\u043F\u0438\u0441\u0430\u0442\u044C\u0441\u044F:',
    ];

    await tg.api('sendMessage', {
      chat_id: chatId,
      text: lines.filter(Boolean).join('\n'),
      reply_markup: {
        inline_keyboard: [[{
          text: '\u{1F4CB} \u041F\u043E\u0441\u043C\u043E\u0442\u0440\u0435\u0442\u044C \u0443\u0441\u043B\u0443\u0433\u0438',
          web_app: { url: WEBAPP_URL + '?slug=' + slug },
        }]],
      },
    });
    return res.status(200).send('ok');
  }

  // Deep link: /start from_app
  if (payload === 'from_app') {
    await tg.send(chatId, [
      '\u{1F381} \u0414\u043E\u0431\u0440\u043E \u043F\u043E\u0436\u0430\u043B\u043E\u0432\u0430\u0442\u044C! \u0412\u044B \u043F\u043E\u0434\u043F\u0438\u0441\u0430\u043B\u0438\u0441\u044C \u043D\u0430 \u0431\u043E\u0442\u0430.',
      '',
      '\u041F\u0440\u043E\u043C\u043E\u043A\u043E\u0434 \u043D\u0430 \u0441\u043A\u0438\u0434\u043A\u0443 15%: BEAUTY15',
      '',
      '\u041F\u043E\u043A\u0430\u0436\u0438\u0442\u0435 \u0435\u0433\u043E \u043C\u0430\u0441\u0442\u0435\u0440\u0443 \u043F\u0440\u0438 \u0437\u0430\u043F\u0438\u0441\u0438.',
    ].join('\n'));
    return res.status(200).send('ok');
  }

  // Regular /start — check if already a master
  const master = await db.query('masters', 'telegram_id=eq.' + from.id + '&limit=1');

  if (master) {
    return await showMasterDashboard(chatId, master, db, tg, res);
  }

  // New user — ask role
  await tg.api('sendMessage', {
    chat_id: chatId,
    text: [
      '\u{1F44B} \u0414\u043E\u0431\u0440\u043E \u043F\u043E\u0436\u0430\u043B\u043E\u0432\u0430\u0442\u044C \u0432 Beauty Bot!',
      '',
      '\u042D\u0442\u043E \u043F\u043B\u0430\u0442\u0444\u043E\u0440\u043C\u0430 \u0434\u043B\u044F \u0431\u044C\u044E\u0442\u0438-\u043C\u0430\u0441\u0442\u0435\u0440\u043E\u0432 \u0438 \u0438\u0445 \u043A\u043B\u0438\u0435\u043D\u0442\u043E\u0432.',
      '',
      '\u041A\u0442\u043E \u0432\u044B?',
    ].join('\n'),
    reply_markup: {
      inline_keyboard: [[
        { text: '\u{1F485} \u042F \u043C\u0430\u0441\u0442\u0435\u0440', callback_data: 'role_master' },
        { text: '\u{1F464} \u042F \u043A\u043B\u0438\u0435\u043D\u0442', callback_data: 'role_client' },
      ]],
    },
  });
  return res.status(200).send('ok');
}

// ===========================================
// /master
// ===========================================

// ===========================================
// /reset
// ===========================================

async function handleReset(chatId, from, db, tg, res) {
  const master = await db.query('masters', 'telegram_id=eq.' + from.id + '&limit=1');

  if (!master) {
    await tg.send(chatId, 'Вы не зарегистрированы. Нажмите /start чтобы начать.');
    return res.status(200).send('ok');
  }

  await tg.api('sendMessage', {
    chat_id: chatId,
    text: '⚠️ Сброс регистрации\n\nМастер: ' + master.name + '\nЭто удалит вашу регистрацию.\n\nПосле сброса вы сможете заново пройти /start и выбрать роль.',
    reply_markup: {
      inline_keyboard: [[
        { text: '✅ Да, сбросить', callback_data: 'confirm_reset' },
        { text: '❌ Отмена', callback_data: 'cancel_reset' },
      ]],
    },
  });
  return res.status(200).send('ok');
}

// ===========================================
// /master
// ===========================================

async function handleMaster(chatId, from, db, tg, res) {
  const master = await db.query('masters', 'telegram_id=eq.' + from.id + '&limit=1');
  if (!master) {
    await tg.send(chatId, '\u0412\u044B \u043D\u0435 \u0437\u0430\u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0438\u0440\u043E\u0432\u0430\u043D\u044B \u043A\u0430\u043A \u043C\u0430\u0441\u0442\u0435\u0440. \u041D\u0430\u0436\u043C\u0438\u0442\u0435 /start');
    return res.status(200).send('ok');
  }
  return await showMasterDashboard(chatId, master, db, tg, res);
}

// ===========================================
// Master dashboard
// ===========================================

async function showMasterDashboard(chatId, master, db, tg, res) {
  const servicesRes = await fetch(
    db.url + '/rest/v1/services?master_id=eq.' + master.id + '&is_active=eq.true&select=id',
    { headers: db.headers }
  );
  const services = await servicesRes.json();

  const today = new Date().toISOString().slice(0, 10);
  const bookingsRes = await fetch(
    db.url + '/rest/v1/bookings?master_id=eq.' + master.id + '&date=eq.' + today + '&status=neq.cancelled&order=time&select=time,client_name,status',
    { headers: db.headers }
  );
  const todayBookings = await bookingsRes.json();

  const shareLink = 'https://t.me/tg_beautybot?start=m_' + master.slug;

  // Trial info
  let trialLine = '';
  if (master.plan === 'pro') {
    trialLine = '\u{1F4CB} \u0422\u0430\u0440\u0438\u0444: PRO \u2B50';
  } else if (master.plan_expires) {
    const expiresDate = new Date(master.plan_expires);
    const now = new Date();
    const daysLeft = Math.ceil((expiresDate - now) / (1000 * 60 * 60 * 24));
    if (daysLeft > 0) {
      trialLine = '\u23F3 \u041F\u0440\u043E\u0431\u043D\u044B\u0439 \u043F\u0435\u0440\u0438\u043E\u0434: ' + daysLeft + ' \u0434\u043D. \u043E\u0441\u0442\u0430\u043B\u043E\u0441\u044C';
    } else {
      trialLine = '\u274C \u041F\u0440\u043E\u0431\u043D\u044B\u0439 \u043F\u0435\u0440\u0438\u043E\u0434 \u0438\u0441\u0442\u0451\u043A. \u041E\u043F\u043B\u0430\u0442\u0438\u0442\u0435 \u0434\u043B\u044F \u043F\u0440\u043E\u0434\u043E\u043B\u0436\u0435\u043D\u0438\u044F.';
    }
  } else {
    trialLine = '\u{1F4CB} \u0422\u0430\u0440\u0438\u0444: \u0411\u0435\u0441\u043F\u043B\u0430\u0442\u043D\u044B\u0439';
  }

  const lines = [
    '\u{1F485} ' + master.name,
    master.speciality || '',
    '',
    '\u{1F4CA} \u0423\u0441\u043B\u0443\u0433: ' + services.length + ' | \u0417\u0430\u043F\u0438\u0441\u0435\u0439 \u0441\u0435\u0433\u043E\u0434\u043D\u044F: ' + todayBookings.length,
    trialLine,
    '',
    '\u{1F4CE} \u0421\u0441\u044B\u043B\u043A\u0430 \u0434\u043B\u044F \u043A\u043B\u0438\u0435\u043D\u0442\u043E\u0432:',
    shareLink,
  ];

  if (todayBookings.length > 0) {
    lines.push('', '\u{1F4C5} \u0417\u0430\u043F\u0438\u0441\u0438 \u043D\u0430 \u0441\u0435\u0433\u043E\u0434\u043D\u044F:');
    for (const b of todayBookings) {
      const icon = b.status === 'confirmed' ? '\u2705' : b.status === 'pending' ? '\u23F3' : '\u2753';
      lines.push(icon + ' ' + b.time.slice(0, 5) + ' \u2014 ' + b.client_name);
    }
  }

  await tg.api('sendMessage', {
    chat_id: chatId,
    text: lines.filter(Boolean).join('\n'),
    reply_markup: {
      inline_keyboard: [
        [{ text: '\u{1F4CB} \u041C\u043E\u0438 \u0437\u0430\u043F\u0438\u0441\u0438', callback_data: 'my_bookings' },
         { text: '\u{1F4CA} \u0421\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0430', callback_data: 'my_stats' }],
        [{ text: '\u2699\uFE0F \u0410\u0434\u043C\u0438\u043D\u043A\u0430', web_app: { url: WEBAPP_URL + '/admin/' } }],
      ],
    },
  });
  return res.status(200).send('ok');
}

// ===========================================
// Text messages (registration flow)
// ===========================================

async function handleText(chatId, from, text, db, tg, res) {
  // Check if registration or reply is in progress
  const sessionRes = await fetch(
    db.url + '/rest/v1/bot_sessions?telegram_id=eq.' + from.id + '&limit=1',
    { headers: db.headers }
  );
  const sessions = await sessionRes.json();
  const session = sessions[0];
  const data = (session && session.data) || {};

  // --- Registration flow ---
  if (data.step === 'await_name') {
    const newData = { step: 'await_speciality', name: text.trim() };
    await db.upsertSession(from.id, newData);

    await tg.send(chatId, [
      '\u{1F44D} \u041E\u0442\u043B\u0438\u0447\u043D\u043E, ' + text.trim() + '!',
      '',
      '\u270F\uFE0F \u0422\u0435\u043F\u0435\u0440\u044C \u043D\u0430\u043F\u0438\u0448\u0438\u0442\u0435 \u0432\u0430\u0448\u0443 \u0441\u043F\u0435\u0446\u0438\u0430\u043B\u044C\u043D\u043E\u0441\u0442\u044C:',
      '\u041D\u0430\u043F\u0440\u0438\u043C\u0435\u0440: \u041C\u0430\u043D\u0438\u043A\u044E\u0440, \u041F\u0435\u0434\u0438\u043A\u044E\u0440',
    ].join('\n'));
    return res.status(200).send('ok');
  }

  if (data.step === 'await_speciality') {
    const name = data.name;
    const speciality = text.trim();
    const slug = generateSlug(name, from.id);

    try {
      // Проверяем — может мастер уже есть (по telegram_id или по slug от прошлой попытки)
      let existArr = [];
      const check1 = await fetch(db.url + '/rest/v1/masters?telegram_id=eq.' + from.id + '&limit=1', { headers: db.headers });
      existArr = await check1.json();
      if (!existArr || existArr.length === 0) {
        const check2 = await fetch(db.url + '/rest/v1/masters?slug=eq.' + slug + '&limit=1', { headers: db.headers });
        existArr = await check2.json();
      }
      let master;

      if (existArr && existArr.length > 0) {
        // Обновляем существующего мастера (восстанавливаем telegram_id)
        const upRes = await fetch(db.url + '/rest/v1/masters?id=eq.' + existArr[0].id, {
          method: 'PATCH',
          headers: { ...db.headers, 'Prefer': 'return=representation' },
          body: JSON.stringify({ telegram_id: from.id, name, speciality, slug, username: from.username || null }),
        });
        if (!upRes.ok) { const err = await upRes.json(); throw new Error(err.message || JSON.stringify(err)); }
        master = (await upRes.json())[0];
      } else {
        // Создаём нового мастера
        const insertRes = await fetch(db.url + '/rest/v1/masters', {
          method: 'POST',
          headers: { ...db.headers, 'Prefer': 'return=representation' },
          body: JSON.stringify({
            telegram_id: from.id,
            username: from.username || null,
            slug: slug,
            name: name,
            speciality: speciality,
            plan_expires: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
          }),
        });
        if (!insertRes.ok) { const err = await insertRes.json(); throw new Error(err.message || JSON.stringify(err)); }
        master = (await insertRes.json())[0];
      }

      await fetch(db.url + '/rest/v1/bot_sessions?telegram_id=eq.' + from.id, {
        method: 'DELETE',
        headers: db.headers,
      });

      const shareLink = 'https://t.me/tg_beautybot?start=m_' + slug;

      await tg.send(chatId, [
        '\u{1F389} \u041F\u0440\u043E\u0444\u0438\u043B\u044C \u0441\u043E\u0437\u0434\u0430\u043D!',
        '',
        '\u{1F464} ' + master.name,
        '\u{1F485} ' + master.speciality,
        '',
        '\u{1F4CE} \u0412\u0430\u0448\u0430 \u0441\u0441\u044B\u043B\u043A\u0430 \u0434\u043B\u044F \u043A\u043B\u0438\u0435\u043D\u0442\u043E\u0432:',
        shareLink,
        '',
        '\u041E\u0442\u043F\u0440\u0430\u0432\u044C\u0442\u0435 \u044D\u0442\u0443 \u0441\u0441\u044B\u043B\u043A\u0443 \u043A\u043B\u0438\u0435\u043D\u0442\u0430\u043C \u2014 \u043F\u043E \u043D\u0435\u0439 \u043E\u043D\u0438 \u043F\u043E\u043F\u0430\u0434\u0443\u0442 \u0432 \u0432\u0430\u0448 \u043A\u0430\u0442\u0430\u043B\u043E\u0433 \u0443\u0441\u043B\u0443\u0433.',
        '',
        '\u{1F449} \u0421\u043B\u0435\u0434\u0443\u044E\u0449\u0438\u0439 \u0448\u0430\u0433: \u0434\u043E\u0431\u0430\u0432\u044C\u0442\u0435 \u0443\u0441\u043B\u0443\u0433\u0438 \u0447\u0435\u0440\u0435\u0437 /master',
      ].join('\n'));
    } catch (err) {
      console.error('Registration error:', err);
      await fetch(db.url + '/rest/v1/bot_sessions?telegram_id=eq.' + from.id, {
        method: 'DELETE',
        headers: db.headers,
      });
      await tg.send(chatId, '\u{1F614} Ошибка при регистрации: ' + err.message);
    }
    return res.status(200).send('ok');
  }

  // --- Master replying to client (PRO) ---
  if (data.step === 'replying_to_client') {
    const clientTgId = data.client_tg_id;
    const masterId = data.master_id;
    const masterName = data.master_name;

    // Clear reply state
    await fetch(db.url + '/rest/v1/bot_sessions?telegram_id=eq.' + from.id, {
      method: 'DELETE',
      headers: db.headers,
    });

    // Save message to DB
    await fetch(db.url + '/rest/v1/messages', {
      method: 'POST',
      headers: db.headers,
      body: JSON.stringify({
        master_id: masterId,
        client_tg_id: clientTgId,
        direction: 'master_to_client',
        text: text,
      }),
    });

    // Deliver to client
    await tg.send(clientTgId, [
      '\u{1F4AC} \u041E\u0442\u0432\u0435\u0442 \u043E\u0442 \u043C\u0430\u0441\u0442\u0435\u0440\u0430 ' + masterName + ':',
      '',
      text,
    ].join('\n'));

    await tg.send(chatId, '\u2705 \u0421\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435 \u0434\u043E\u0441\u0442\u0430\u0432\u043B\u0435\u043D\u043E \u043A\u043B\u0438\u0435\u043D\u0442\u0443!');
    return res.status(200).send('ok');
  }

  // --- Bot consultant: client message ---
  return await handleClientMessage(chatId, from, text, data, db, tg, res);
}

// ===========================================
// Bot consultant — auto-replies + forwarding
// ===========================================

async function handleClientMessage(chatId, from, text, sessionData, db, tg, res) {
  // Find linked master: from session (deep link) or from bookings
  var masterId = sessionData.linked_master_id || null;
  var master = null;

  if (masterId) {
    master = await db.query('masters', 'id=eq.' + masterId + '&limit=1');
  }

  // If no link from session, try to find from bookings
  if (!master) {
    const bookingRes = await fetch(
      db.url + '/rest/v1/bookings?client_tg_id=eq.' + from.id + '&status=neq.cancelled&order=created_at.desc&limit=1&select=master_id',
      { headers: db.headers }
    );
    const bookings = await bookingRes.json();
    if (bookings[0]) {
      masterId = bookings[0].master_id;
      master = await db.query('masters', 'id=eq.' + masterId + '&limit=1');
    }
  }

  // Check if sender is actually a master (not a client)
  const senderMaster = await db.query('masters', 'telegram_id=eq.' + from.id + '&limit=1');
  if (senderMaster) {
    // Master is typing in bot but not in reply mode — just ignore
    return res.status(200).send('ok');
  }

  if (!master) {
    await tg.send(chatId, [
      '\u{1F44B} \u0427\u0442\u043E\u0431\u044B \u0437\u0430\u043F\u0438\u0441\u0430\u0442\u044C\u0441\u044F \u043A \u043C\u0430\u0441\u0442\u0435\u0440\u0443, \u043F\u0435\u0440\u0435\u0439\u0434\u0438\u0442\u0435 \u043F\u043E \u0441\u0441\u044B\u043B\u043A\u0435, \u043A\u043E\u0442\u043E\u0440\u0443\u044E \u0432\u0430\u043C \u043F\u0440\u0438\u0441\u043B\u0430\u043B \u043C\u0430\u0441\u0442\u0435\u0440.',
      '',
      '\u0421\u0441\u044B\u043B\u043A\u0430 \u0432\u044B\u0433\u043B\u044F\u0434\u0438\u0442 \u0442\u0430\u043A:',
      't.me/tg_beautybot?start=m_\u0438\u043C\u044F_\u043C\u0430\u0441\u0442\u0435\u0440\u0430',
    ].join('\n'));
    return res.status(200).send('ok');
  }

  // Try auto-reply on keywords
  const lower = text.toLowerCase();
  const autoReply = await tryAutoReply(lower, master, db);

  if (autoReply) {
    await tg.send(chatId, autoReply);
    return res.status(200).send('ok');
  }

  // No keyword matched — forward to master if PRO
  if (master.plan !== 'pro') {
    // FREE master — show generic response with booking link
    const slug = master.slug || sessionData.linked_slug;
    await tg.api('sendMessage', {
      chat_id: chatId,
      text: [
        '\u{1F914} \u041D\u0435 \u0441\u043C\u043E\u0433 \u0440\u0430\u0441\u043F\u043E\u0437\u043D\u0430\u0442\u044C \u0432\u0430\u0448 \u0432\u043E\u043F\u0440\u043E\u0441.',
        '',
        '\u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u0441\u043F\u0440\u043E\u0441\u0438\u0442\u044C:',
        '\u2022 \u0446\u0435\u043D\u0430 / \u043F\u0440\u0430\u0439\u0441',
        '\u2022 \u0430\u0434\u0440\u0435\u0441',
        '\u2022 \u0432\u0440\u0435\u043C\u044F / \u0437\u0430\u043F\u0438\u0441\u044C',
        '\u2022 \u0442\u0435\u043B\u0435\u0444\u043E\u043D',
      ].join('\n'),
      reply_markup: slug ? {
        inline_keyboard: [[{
          text: '\u{1F4CB} \u041F\u043E\u0441\u043C\u043E\u0442\u0440\u0435\u0442\u044C \u0443\u0441\u043B\u0443\u0433\u0438',
          web_app: { url: WEBAPP_URL + '?slug=' + slug },
        }]],
      } : undefined,
    });
    return res.status(200).send('ok');
  }

  // PRO — forward message to master
  const clientName = from.first_name || '\u041A\u043B\u0438\u0435\u043D\u0442';
  const clientUsername = from.username ? ' (@' + from.username + ')' : '';

  // Save message to DB
  await fetch(db.url + '/rest/v1/messages', {
    method: 'POST',
    headers: db.headers,
    body: JSON.stringify({
      master_id: master.id,
      client_tg_id: from.id,
      direction: 'client_to_master',
      text: text,
    }),
  });

  // Send to master with reply button
  await tg.api('sendMessage', {
    chat_id: master.telegram_id,
    text: [
      '\u{1F4E8} \u0421\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435 \u043E\u0442 \u043A\u043B\u0438\u0435\u043D\u0442\u0430 ' + clientName + clientUsername + ':',
      '',
      text,
    ].join('\n'),
    reply_markup: {
      inline_keyboard: [[
        { text: '\u2709\uFE0F \u041E\u0442\u0432\u0435\u0442\u0438\u0442\u044C', callback_data: 'reply_client_' + from.id },
      ]],
    },
  });

  await tg.send(chatId, '\u2709\uFE0F \u0412\u0430\u0448\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435 \u043F\u0435\u0440\u0435\u0434\u0430\u043D\u043E \u043C\u0430\u0441\u0442\u0435\u0440\u0443. \u041E\u0442\u0432\u0435\u0442 \u043F\u0440\u0438\u0434\u0451\u0442 \u0432 \u044D\u0442\u043E\u0442 \u0447\u0430\u0442.');
  return res.status(200).send('ok');
}

// ===========================================
// Auto-reply on keywords
// ===========================================

async function tryAutoReply(lower, master, db) {
  // --- Price / services ---
  if (matchKeywords(lower, ['\u0446\u0435\u043D', '\u043F\u0440\u0430\u0439\u0441', '\u0441\u0442\u043E\u0438\u043C\u043E\u0441\u0442', '\u0441\u043A\u043E\u043B\u044C\u043A\u043E \u0441\u0442\u043E\u0438\u0442', '\u0441\u043A\u043E\u043B\u044C\u043A\u043E \u0441\u0442\u043E\u044F\u0442', '\u0443\u0441\u043B\u0443\u0433'])) {
    const servicesRes = await fetch(
      db.url + '/rest/v1/services?master_id=eq.' + master.id + '&is_active=eq.true&order=sort_order,name&select=name,price,duration,emoji',
      { headers: db.headers }
    );
    const services = await servicesRes.json();

    if (!services || services.length === 0) {
      return '\u{1F485} \u0423 \u043C\u0430\u0441\u0442\u0435\u0440\u0430 ' + master.name + ' \u043F\u043E\u043A\u0430 \u043D\u0435\u0442 \u0443\u0441\u043B\u0443\u0433 \u0432 \u043A\u0430\u0442\u0430\u043B\u043E\u0433\u0435.';
    }

    const lines = ['\u{1F485} \u0423\u0441\u043B\u0443\u0433\u0438 \u043C\u0430\u0441\u0442\u0435\u0440\u0430 ' + master.name + ':', ''];
    for (const s of services) {
      const price = Number(s.price).toLocaleString('ru-RU') + ' \u20BD';
      const dur = s.duration + ' \u043C\u0438\u043D';
      lines.push((s.emoji || '\u{1F485}') + ' ' + s.name + ' \u2014 ' + price + ' (' + dur + ')');
    }
    return lines.join('\n');
  }

  // --- Address ---
  if (matchKeywords(lower, ['\u0430\u0434\u0440\u0435\u0441', '\u0433\u0434\u0435 \u043D\u0430\u0445\u043E\u0434', '\u043A\u0430\u043A \u0434\u043E\u0431\u0440\u0430\u0442\u044C\u0441\u044F', '\u0440\u0430\u0441\u043F\u043E\u043B\u043E\u0436\u0435\u043D', '\u043C\u0435\u0441\u0442\u043E'])) {
    if (master.address) {
      return '\u{1F4CD} \u0410\u0434\u0440\u0435\u0441: ' + master.address;
    }
    return '\u{1F4CD} \u041C\u0430\u0441\u0442\u0435\u0440 \u043F\u043E\u043A\u0430 \u043D\u0435 \u0443\u043A\u0430\u0437\u0430\u043B \u0430\u0434\u0440\u0435\u0441.';
  }

  // --- Time / booking ---
  if (matchKeywords(lower, ['\u0432\u0440\u0435\u043C\u044F', '\u043A\u043E\u0433\u0434\u0430', '\u0437\u0430\u043F\u0438\u0441', '\u0441\u0432\u043E\u0431\u043E\u0434\u043D', '\u0441\u043B\u043E\u0442', '\u0440\u0430\u0441\u043F\u0438\u0441\u0430\u043D\u0438\u0435', '\u0433\u0440\u0430\u0444\u0438\u043A'])) {
    // Get schedule
    const schedRes = await fetch(
      db.url + '/rest/v1/schedule?master_id=eq.' + master.id + '&is_working=eq.true&order=day_of_week&select=day_of_week,start_time,end_time',
      { headers: db.headers }
    );
    const schedule = await schedRes.json();

    const dayNames = ['\u041F\u043D', '\u0412\u0442', '\u0421\u0440', '\u0427\u0442', '\u041F\u0442', '\u0421\u0431', '\u0412\u0441'];
    const lines = ['\u{1F4C5} \u0413\u0440\u0430\u0444\u0438\u043A \u0440\u0430\u0431\u043E\u0442\u044B ' + master.name + ':', ''];

    if (schedule.length === 0) {
      lines.push('\u0420\u0430\u0441\u043F\u0438\u0441\u0430\u043D\u0438\u0435 \u043D\u0435 \u043D\u0430\u0441\u0442\u0440\u043E\u0435\u043D\u043E.');
    } else {
      for (const s of schedule) {
        lines.push(dayNames[s.day_of_week] + ': ' + s.start_time.slice(0, 5) + ' \u2013 ' + s.end_time.slice(0, 5));
      }
    }
    lines.push('', '\u0414\u043B\u044F \u0437\u0430\u043F\u0438\u0441\u0438 \u043D\u0430\u0436\u043C\u0438\u0442\u0435 \u043A\u043D\u043E\u043F\u043A\u0443 \u00AB\u041F\u043E\u0441\u043C\u043E\u0442\u0440\u0435\u0442\u044C \u0443\u0441\u043B\u0443\u0433\u0438\u00BB \u0432\u044B\u0448\u0435.');
    return lines.join('\n');
  }

  // --- Phone / contact ---
  if (matchKeywords(lower, ['\u0442\u0435\u043B\u0435\u0444\u043E\u043D', '\u043F\u043E\u0437\u0432\u043E\u043D\u0438\u0442\u044C', '\u043A\u043E\u043D\u0442\u0430\u043A\u0442', '\u043D\u043E\u043C\u0435\u0440', '\u0441\u0432\u044F\u0437\u0430\u0442\u044C\u0441\u044F'])) {
    if (master.phone) {
      return '\u{1F4DE} \u0422\u0435\u043B\u0435\u0444\u043E\u043D: ' + master.phone;
    }
    return '\u{1F4DE} \u041C\u0430\u0441\u0442\u0435\u0440 \u043F\u043E\u043A\u0430 \u043D\u0435 \u0443\u043A\u0430\u0437\u0430\u043B \u0442\u0435\u043B\u0435\u0444\u043E\u043D.';
  }

  // No keyword matched
  return null;
}

function matchKeywords(text, keywords) {
  return keywords.some(function(kw) { return text.includes(kw); });
}

// ===========================================
// Callback queries
// ===========================================

async function handleCallback(cb, db, tg, res) {
  const data = cb.data || '';
  const chatId = cb.message.chat.id;
  const from = cb.from;

  // Always answer callback
  await tg.api('answerCallbackQuery', { callback_query_id: cb.id });

  // --- Reset: confirm ---
  if (data === 'confirm_reset') {
    try {
      // Обнуляем telegram_id вместо удаления (FK constraints не дают удалить)
      const resetRes = await fetch(db.url + '/rest/v1/masters?telegram_id=eq.' + from.id, {
        method: 'PATCH',
        headers: { ...db.headers, 'Prefer': 'return=representation' },
        body: JSON.stringify({ telegram_id: -Date.now() }),
      });
      const resetResult = await resetRes.json();
      if (!resetRes.ok || !resetResult || resetResult.length === 0) {
        throw new Error('Не удалось сбросить: ' + JSON.stringify(resetResult));
      }
      await tg.api('editMessageText', {
        chat_id: chatId,
        message_id: cb.message.message_id,
        text: '✅ Регистрация сброшена!\n\nНажмите /start чтобы начать заново.',
      });
    } catch (e) {
      await tg.api('editMessageText', {
        chat_id: chatId,
        message_id: cb.message.message_id,
        text: '❌ Ошибка при сбросе: ' + e.message,
      });
    }
    return res.status(200).send('ok');
  }

  // --- Reset: cancel ---
  if (data === 'cancel_reset') {
    await tg.api('editMessageText', {
      chat_id: chatId,
      message_id: cb.message.message_id,
      text: 'Сброс отменён. Всё как было 👌',
    });
    return res.status(200).send('ok');
  }

  // --- Role: master ---
  if (data === 'role_master') {
    // Check if already registered
    const existing = await db.query('masters', 'telegram_id=eq.' + from.id + '&limit=1');
    if (existing) {
      return await showMasterDashboard(chatId, existing, db, tg, res);
    }

    // Start registration — save state
    await db.upsertSession(from.id, { step: 'await_name' });

    await tg.api('editMessageText', {
      chat_id: chatId,
      message_id: cb.message.message_id,
      text: [
        '\u{1F485} \u041E\u0442\u043B\u0438\u0447\u043D\u043E! \u0414\u0430\u0432\u0430\u0439\u0442\u0435 \u0441\u043E\u0437\u0434\u0430\u0434\u0438\u043C \u0432\u0430\u0448 \u043F\u0440\u043E\u0444\u0438\u043B\u044C \u043C\u0430\u0441\u0442\u0435\u0440\u0430.',
        '',
        '\u270F\uFE0F \u041D\u0430\u043F\u0438\u0448\u0438\u0442\u0435 \u0432\u0430\u0448\u0435 \u0438\u043C\u044F \u0438 \u0444\u0430\u043C\u0438\u043B\u0438\u044E:',
        '\u041D\u0430\u043F\u0440\u0438\u043C\u0435\u0440: \u0410\u043D\u043D\u0430 \u0418\u0432\u0430\u043D\u043E\u0432\u0430',
      ].join('\n'),
    });
    return res.status(200).send('ok');
  }

  // --- Role: client ---
  if (data === 'role_client') {
    await tg.api('editMessageText', {
      chat_id: chatId,
      message_id: cb.message.message_id,
      text: [
        '\u{1F44B} \u0414\u043E\u0431\u0440\u043E \u043F\u043E\u0436\u0430\u043B\u043E\u0432\u0430\u0442\u044C!',
        '',
        '\u0427\u0442\u043E\u0431\u044B \u0437\u0430\u043F\u0438\u0441\u0430\u0442\u044C\u0441\u044F \u043A \u043C\u0430\u0441\u0442\u0435\u0440\u0443, \u043F\u0435\u0440\u0435\u0439\u0434\u0438\u0442\u0435 \u043F\u043E \u0441\u0441\u044B\u043B\u043A\u0435, \u043A\u043E\u0442\u043E\u0440\u0443\u044E \u0432\u0430\u043C \u043F\u0440\u0438\u0441\u043B\u0430\u043B \u043C\u0430\u0441\u0442\u0435\u0440.',
        '',
        '\u0421\u0441\u044B\u043B\u043A\u0430 \u0432\u044B\u0433\u043B\u044F\u0434\u0438\u0442 \u0442\u0430\u043A:',
        't.me/tg_beautybot?start=m_\u0438\u043C\u044F_\u043C\u0430\u0441\u0442\u0435\u0440\u0430',
      ].join('\n'),
    });
    return res.status(200).send('ok');
  }

  // --- My bookings ---
  if (data === 'my_bookings') {
    const master = await db.query('masters', 'telegram_id=eq.' + from.id + '&limit=1');
    if (!master) return res.status(200).send('ok');

    const bookingsRes = await fetch(
      db.url + '/rest/v1/bookings?master_id=eq.' + master.id + '&status=neq.cancelled&order=date,time&select=date,time,client_name,status',
      { headers: db.headers }
    );
    const bookings = await bookingsRes.json();

    if (bookings.length === 0) {
      await tg.api('editMessageText', {
        chat_id: chatId,
        message_id: cb.message.message_id,
        text: '\u{1F4CB} \u0423 \u0432\u0430\u0441 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442 \u0437\u0430\u043F\u0438\u0441\u0435\u0439.',
      });
      return res.status(200).send('ok');
    }

    const lines = ['\u{1F4CB} \u0412\u0430\u0448\u0438 \u0437\u0430\u043F\u0438\u0441\u0438:'];
    for (const b of bookings) {
      const icon = b.status === 'confirmed' ? '\u2705' : b.status === 'pending' ? '\u23F3' : '\u2753';
      lines.push(icon + ' ' + b.date + ' ' + b.time.slice(0, 5) + ' \u2014 ' + b.client_name);
    }

    await tg.api('editMessageText', {
      chat_id: chatId,
      message_id: cb.message.message_id,
      text: lines.join('\n'),
    });
    return res.status(200).send('ok');
  }

  // --- My stats ---
  if (data === 'my_stats') {
    const master = await db.query('masters', 'telegram_id=eq.' + from.id + '&limit=1');
    if (!master) return res.status(200).send('ok');

    const servicesRes = await fetch(
      db.url + '/rest/v1/services?master_id=eq.' + master.id + '&is_active=eq.true&select=id',
      { headers: db.headers }
    );
    const services = await servicesRes.json();

    const bookingsRes = await fetch(
      db.url + '/rest/v1/bookings?master_id=eq.' + master.id + '&status=neq.cancelled&select=status',
      { headers: db.headers }
    );
    const bookings = await bookingsRes.json();
    const confirmed = bookings.filter(b => b.status === 'confirmed').length;
    const pending = bookings.filter(b => b.status === 'pending').length;

    await tg.api('editMessageText', {
      chat_id: chatId,
      message_id: cb.message.message_id,
      text: [
        '\u{1F4CA} \u0421\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0430:',
        '',
        '\u{1F485} \u0423\u0441\u043B\u0443\u0433: ' + services.length,
        '\u{1F4CB} \u0412\u0441\u0435\u0433\u043E \u0437\u0430\u043F\u0438\u0441\u0435\u0439: ' + bookings.length,
        '\u2705 \u041F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0451\u043D\u043D\u044B\u0445: ' + confirmed,
        '\u23F3 \u041E\u0436\u0438\u0434\u0430\u044E\u0442: ' + pending,
        '',
        '\u{1F4CB} \u0422\u0430\u0440\u0438\u0444: ' + (master.plan === 'pro' ? 'PRO \u2B50' : '\u0411\u0435\u0441\u043F\u043B\u0430\u0442\u043D\u044B\u0439'),
      ].join('\n'),
    });
    return res.status(200).send('ok');
  }

  // --- Reply to client (PRO) ---
  const replyMatch = data.match(/^reply_client_(\d+)$/);
  if (replyMatch) {
    const clientTgId = parseInt(replyMatch[1], 10);

    // Check if sender is a master
    const master = await db.query('masters', 'telegram_id=eq.' + from.id + '&limit=1');
    if (!master) return res.status(200).send('ok');

    // Set session state: master is replying to this client
    await db.upsertSession(from.id, {
      step: 'replying_to_client',
      client_tg_id: clientTgId,
      master_id: master.id,
      master_name: master.name,
    });

    await tg.api('editMessageText', {
      chat_id: chatId,
      message_id: cb.message.message_id,
      text: (cb.message.text || '') + '\n\n\u270F\uFE0F \u041D\u0430\u043F\u0438\u0448\u0438\u0442\u0435 \u043E\u0442\u0432\u0435\u0442 \u043A\u043B\u0438\u0435\u043D\u0442\u0443:',
    });
    return res.status(200).send('ok');
  }

  // --- Booking confirm/cancel ---
  const match = data.match(/^booking_(confirm|cancel)_(.+)$/);
  if (match) {
    const action = match[1];
    const bookingId = match[2];
    const newStatus = action === 'confirm' ? 'confirmed' : 'cancelled';

    // Update booking status
    await fetch(db.url + '/rest/v1/bookings?id=eq.' + bookingId, {
      method: 'PATCH',
      headers: { ...db.headers, 'Prefer': 'return=representation' },
      body: JSON.stringify({ status: newStatus }),
    });

    // Get booking with related data
    const bookingRes = await fetch(
      db.url + '/rest/v1/bookings?id=eq.' + bookingId + '&select=*,services(name,emoji,price,duration),masters(name,telegram_id,address)',
      { headers: db.headers }
    );
    const bookings = await bookingRes.json();
    const booking = bookings[0];
    if (!booking) return res.status(200).send('ok');

    // Update master's message
    const statusText = action === 'confirm' ? '\u2705 \u041F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u043E' : '\u274C \u041E\u0442\u043C\u0435\u043D\u0435\u043D\u043E';
    const originalText = (cb.message && cb.message.text) || '';

    await tg.api('editMessageText', {
      chat_id: chatId,
      message_id: cb.message.message_id,
      text: originalText + '\n\n' + statusText,
    });

    // Notify client
    const serviceName = (booking.services && booking.services.name) || '\u0423\u0441\u043B\u0443\u0433\u0430';
    const serviceEmoji = (booking.services && booking.services.emoji) || '\u{1F485}';
    const masterName = (booking.masters && booking.masters.name) || '\u041C\u0430\u0441\u0442\u0435\u0440';
    const masterAddress = booking.masters && booking.masters.address;
    const timeStr = booking.time ? booking.time.slice(0, 5) : '';

    if (action === 'confirm') {
      await tg.send(booking.client_tg_id, [
        '\u2705 \u0412\u0430\u0448\u0430 \u0437\u0430\u043F\u0438\u0441\u044C \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u0430!',
        '',
        serviceEmoji + ' ' + serviceName,
        '\u{1F4C5} ' + booking.date + ' \u0432 ' + timeStr,
        masterAddress ? ('\u{1F4CD} ' + masterAddress) : '',
        '',
        '\u041C\u0430\u0441\u0442\u0435\u0440: ' + masterName,
      ].filter(Boolean).join('\n'));

      // Устанавливаем дату напоминания о повторном визите
      const reminderWeeks = (booking.services && booking.services.reminder_weeks) || 4;
      const visitDate = new Date(booking.date + 'T12:00:00Z');
      const nextReminder = new Date(visitDate.getTime() + reminderWeeks * 7 * 24 * 60 * 60 * 1000);
      await fetch(db.url + '/rest/v1/bookings?id=eq.' + bookingId, {
        method: 'PATCH',
        headers: { ...db.headers, 'Prefer': 'return=minimal' },
        body: JSON.stringify({ next_reminder_at: nextReminder.toISOString(), reminder_repeat_sent: false }),
      });
    } else {
      await tg.send(booking.client_tg_id, [
        '\u274C \u041A \u0441\u043E\u0436\u0430\u043B\u0435\u043D\u0438\u044E, \u043C\u0430\u0441\u0442\u0435\u0440 \u043E\u0442\u043C\u0435\u043D\u0438\u043B \u0432\u0430\u0448\u0443 \u0437\u0430\u043F\u0438\u0441\u044C.',
        '',
        serviceEmoji + ' ' + serviceName,
        '\u{1F4C5} ' + booking.date + ' \u0432 ' + timeStr,
        '',
        '\u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u0432\u044B\u0431\u0440\u0430\u0442\u044C \u0434\u0440\u0443\u0433\u043E\u0435 \u0432\u0440\u0435\u043C\u044F.',
      ].join('\n'));
    }

    return res.status(200).send('ok');
  }

  return res.status(200).send('ok');
}

// ===========================================
// Slug generator (transliteration)
// ===========================================

function generateSlug(name, telegramId) {
  const map = {
    '\u0430': 'a', '\u0431': 'b', '\u0432': 'v', '\u0433': 'g', '\u0434': 'd', '\u0435': 'e', '\u0451': 'e',
    '\u0436': 'zh', '\u0437': 'z', '\u0438': 'i', '\u0439': 'y', '\u043A': 'k', '\u043B': 'l', '\u043C': 'm',
    '\u043D': 'n', '\u043E': 'o', '\u043F': 'p', '\u0440': 'r', '\u0441': 's', '\u0442': 't', '\u0443': 'u',
    '\u0444': 'f', '\u0445': 'h', '\u0446': 'ts', '\u0447': 'ch', '\u0448': 'sh', '\u0449': 'shch',
    '\u044A': '', '\u044B': 'y', '\u044C': '', '\u044D': 'e', '\u044E': 'yu', '\u044F': 'ya',
  };
  const slug = name.toLowerCase()
    .split('')
    .map(ch => map[ch] !== undefined ? map[ch] : ch)
    .join('')
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 20);
  return slug + '_' + String(telegramId).slice(-4);
}

// ===========================================
// Helpers
// ===========================================

function createDb(url, key) {
  const headers = {
    'apikey': key,
    'Authorization': 'Bearer ' + key,
    'Content-Type': 'application/json',
  };

  return {
    url,
    headers,
    async query(table, params) {
      const r = await fetch(url + '/rest/v1/' + table + '?' + params, { headers });
      const rows = await r.json();
      return rows[0] || null;
    },
    async upsertSession(telegramId, data) {
      await fetch(url + '/rest/v1/bot_sessions', {
        method: 'POST',
        headers: { ...headers, 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify({
          telegram_id: telegramId,
          data: data,
          updated_at: new Date().toISOString(),
        }),
      });
    },
  };
}

// ===========================================
// Cron: напоминания о записях
// GET /api/webhook?cron=reminders&key=SECRET
// ===========================================

async function handleCronReminders(req, res) {
  const CRON_SECRET = process.env.CRON_SECRET;
  if (CRON_SECRET && req.query.key !== CRON_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const BOT_TOKEN = process.env.BOT_TOKEN;

  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY,
    'Content-Type': 'application/json',
  };

  // Текущее время в Москве (UTC+3)
  const now = new Date();
  const mskOffset = 3 * 60 * 60 * 1000;
  const msk = new Date(now.getTime() + mskOffset);

  const today = msk.toISOString().slice(0, 10);
  const tomorrow = new Date(msk.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const mskHours = msk.getUTCHours();
  const mskMinutes = msk.getUTCMinutes();
  const currentMinutes = mskHours * 60 + mskMinutes;

  const results = { sent_24h: 0, sent_2h: 0, errors: 0 };

  try {
    const bookingsRes = await fetch(
      SUPABASE_URL + '/rest/v1/bookings?status=eq.confirmed&date=in.(' + today + ',' + tomorrow + ')&select=*,services(name),masters(name,telegram_id)',
      { headers }
    );

    if (!bookingsRes.ok) {
      return res.status(500).json({ error: 'Failed to fetch bookings' });
    }

    const bookings = await bookingsRes.json();
    const tg = createTg(BOT_TOKEN);

    for (const booking of bookings) {
      const [bH, bM] = booking.time.split(':').map(Number);
      const bookingMinutes = bH * 60 + bM;

      let minutesUntil;
      if (booking.date === today) {
        minutesUntil = bookingMinutes - currentMinutes;
      } else if (booking.date === tomorrow) {
        minutesUntil = (24 * 60 - currentMinutes) + bookingMinutes;
      } else {
        continue;
      }

      const serviceName = booking.services ? booking.services.name : 'Услуга';
      const masterName = booking.masters ? booking.masters.name : 'Мастер';

      // Напоминание за 24 часа (окно 23-25 часов)
      if (!booking.reminder_24h && minutesUntil >= 23 * 60 && minutesUntil <= 25 * 60) {
        if (booking.client_tg_id && booking.client_tg_id !== 0) {
          await tg.send(booking.client_tg_id, [
            '\ud83d\udd14 \u041d\u0430\u043f\u043e\u043c\u0438\u043d\u0430\u043d\u0438\u0435 \u043e \u0437\u0430\u043f\u0438\u0441\u0438 \u0437\u0430\u0432\u0442\u0440\u0430!',
            '',
            '\ud83d\udc87 ' + serviceName,
            '\ud83d\udcc5 ' + formatDateRu(booking.date) + ' \u0432 ' + booking.time.slice(0, 5),
            '\ud83d\udc69 \u041c\u0430\u0441\u0442\u0435\u0440: ' + masterName,
            '',
            '\u0416\u0434\u0451\u043c \u0432\u0430\u0441! \u0415\u0441\u043b\u0438 \u043d\u0443\u0436\u043d\u043e \u043e\u0442\u043c\u0435\u043d\u0438\u0442\u044c \u2014 \u0441\u0434\u0435\u043b\u0430\u0439\u0442\u0435 \u044d\u0442\u043e \u0437\u0430\u0440\u0430\u043d\u0435\u0435.',
          ].join('\n'));
          results.sent_24h++;
        }
        await fetch(SUPABASE_URL + '/rest/v1/bookings?id=eq.' + booking.id, {
          method: 'PATCH',
          headers: { ...headers, 'Prefer': 'return=minimal' },
          body: JSON.stringify({ reminder_24h: true }),
        });
      }

      // Напоминание за 2 часа (окно 1.5-2.5 часа)
      if (!booking.reminder_2h && minutesUntil >= 90 && minutesUntil <= 150) {
        if (booking.client_tg_id && booking.client_tg_id !== 0) {
          await tg.send(booking.client_tg_id, [
            '\u23f0 \u0427\u0435\u0440\u0435\u0437 2 \u0447\u0430\u0441\u0430 \u0432\u0430\u0448\u0430 \u0437\u0430\u043f\u0438\u0441\u044c!',
            '',
            '\ud83d\udc87 ' + serviceName,
            '\ud83d\udd50 \u0421\u0435\u0433\u043e\u0434\u043d\u044f \u0432 ' + booking.time.slice(0, 5),
            '\ud83d\udc69 \u041c\u0430\u0441\u0442\u0435\u0440: ' + masterName,
            '',
            '\u0414\u043e \u0432\u0441\u0442\u0440\u0435\u0447\u0438! \ud83d\udc95',
          ].join('\n'));
          results.sent_2h++;
        }
        await fetch(SUPABASE_URL + '/rest/v1/bookings?id=eq.' + booking.id, {
          method: 'PATCH',
          headers: { ...headers, 'Prefer': 'return=minimal' },
          body: JSON.stringify({ reminder_2h: true }),
        });
      }
    }

    // Повторные напоминания о визите (next_reminder_at <= сегодня)
    const repeatRes = await fetch(
      SUPABASE_URL + '/rest/v1/bookings?status=eq.confirmed&reminder_repeat_sent=eq.false&next_reminder_at=lte.' + now.toISOString() + '&client_tg_id=neq.0&select=*,services(name,emoji,reminder_weeks),masters(name,slug)',
      { headers }
    );
    if (repeatRes.ok) {
      const repeatBookings = await repeatRes.json();
      for (const b of repeatBookings) {
        if (!b.client_tg_id) continue;
        const sName = b.services ? b.services.name : 'услугу';
        const sEmoji = (b.services && b.services.emoji) || '\u{1F485}';
        const mName = b.masters ? b.masters.name : '\u043C\u0430\u0441\u0442\u0435\u0440\u0443';
        const slug = b.masters ? b.masters.slug : null;
        const bookUrl = slug ? (process.env.WEBAPP_URL || 'https://tg-app-tan.vercel.app') + '/?master=' + slug : null;

        try {
          await fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: b.client_tg_id,
              text: [
                '\u{1F44B} \u041F\u0440\u0438\u0432\u0435\u0442! \u041F\u043E\u0440\u0430 \u0437\u0430\u043F\u0438\u0441\u0430\u0442\u044C\u0441\u044F \u0441\u043D\u043E\u0432\u0430.',
                '',
                sEmoji + ' \u041F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0439 \u0440\u0430\u0437 \u0432\u044B \u0437\u0430\u043F\u0438\u0441\u044B\u0432\u0430\u043B\u0438\u0441\u044C \u043D\u0430 \xAB' + sName + '\xBB',
                '\u{1F469} \u041C\u0430\u0441\u0442\u0435\u0440: ' + mName,
                '',
                '\u0425\u043E\u0442\u0438\u0442\u0435 \u0437\u0430\u043F\u0438\u0441\u0430\u0442\u044C\u0441\u044F \u0441\u043D\u043E\u0432\u0430? \u{1F447}',
              ].join('\n'),
              reply_markup: bookUrl ? {
                inline_keyboard: [[
                  { text: '\u{1F4C5} \u0417\u0430\u043F\u0438\u0441\u0430\u0442\u044C\u0441\u044F', web_app: { url: bookUrl } },
                ]],
              } : undefined,
            }),
          });
          results.sent_24h++; // считаем в общий счётчик
        } catch (e) { results.errors++; }

        await fetch(SUPABASE_URL + '/rest/v1/bookings?id=eq.' + b.id, {
          method: 'PATCH',
          headers: { ...headers, 'Prefer': 'return=minimal' },
          body: JSON.stringify({ reminder_repeat_sent: true }),
        });
      }
    }

    return res.status(200).json({
      ok: true,
      processed: bookings.length,
      ...results,
      timestamp: msk.toISOString(),
    });

  } catch (err) {
    console.error('Cron reminders error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

function formatDateRu(dateStr) {
  const months = [
    '\u044f\u043d\u0432\u0430\u0440\u044f', '\u0444\u0435\u0432\u0440\u0430\u043b\u044f', '\u043c\u0430\u0440\u0442\u0430', '\u0430\u043f\u0440\u0435\u043b\u044f', '\u043c\u0430\u044f', '\u0438\u044e\u043d\u044f',
    '\u0438\u044e\u043b\u044f', '\u0430\u0432\u0433\u0443\u0441\u0442\u0430', '\u0441\u0435\u043d\u0442\u044f\u0431\u0440\u044f', '\u043e\u043a\u0442\u044f\u0431\u0440\u044f', '\u043d\u043e\u044f\u0431\u0440\u044f', '\u0434\u0435\u043a\u0430\u0431\u0440\u044f',
  ];
  const parts = dateStr.split('-');
  return parseInt(parts[2]) + ' ' + months[parseInt(parts[1]) - 1];
}

function createTg(token) {
  return {
    async api(method, body) {
      const resp = await fetch('https://api.telegram.org/bot' + token + '/' + method, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await resp.json();
      if (!result.ok) {
        console.error('TG API error:', method, JSON.stringify(result));
      }
      return result;
    },
    async send(chatId, text) {
      return this.api('sendMessage', { chat_id: chatId, text: text });
    },
  };
}
