const { Bot, InlineKeyboard, webhookCallback } = require('grammy');
const db = require('./supabase');

const bot = new Bot(process.env.BOT_TOKEN);

const WEBAPP_URL = 'https://tg-app-tan.vercel.app';

// --- Генерация slug из имени ---
function generateSlug(name, telegramId) {
  const translitMap = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e',
    'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm',
    'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
    'ф': 'f', 'х': 'h', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'shch',
    'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',
  };
  const slug = name.toLowerCase()
    .split('')
    .map(ch => translitMap[ch] || ch)
    .join('')
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 20);
  // Добавляем часть telegram_id для уникальности
  return slug + '_' + String(telegramId).slice(-4);
}

// ===========================================
// /start — точка входа
// ===========================================

bot.command('start', async (ctx) => {
  const payload = ctx.match; // Текст после /start (deep link параметр)

  // Deep link: /start m_<slug> → клиент пришёл к мастеру
  if (payload && payload.startsWith('m_')) {
    const slug = payload.slice(2);
    return handleClientDeepLink(ctx, slug);
  }

  // Deep link: /start from_app → подписка из оффер-модалки
  if (payload === 'from_app') {
    return ctx.reply(
      '🎁 Добро пожаловать! Вы подписались на бота.\n\n' +
      'Промокод на скидку 15%: BEAUTY15\n\n' +
      'Покажите его мастеру при записи.'
    );
  }

  // Обычный /start — проверяем, зарегистрирован ли как мастер
  const master = await db.findMasterByTgId(ctx.from.id);

  if (master) {
    // Уже зарегистрированный мастер
    return showMasterDashboard(ctx, master);
  }

  // Новый пользователь — спрашиваем роль
  const keyboard = new InlineKeyboard()
    .text('💅 Я мастер', 'role_master')
    .text('👤 Я клиент', 'role_client');

  await ctx.reply(
    '👋 Добро пожаловать в Beauty Bot!\n\n' +
    'Это платформа для бьюти-мастеров и их клиентов.\n\n' +
    'Кто вы?',
    { reply_markup: keyboard }
  );
});

// ===========================================
// Клиент пришёл по deep link мастера
// ===========================================

async function handleClientDeepLink(ctx, slug) {
  const master = await db.findMasterBySlug(slug);

  if (!master) {
    return ctx.reply('😔 Мастер не найден. Проверьте ссылку.');
  }

  const keyboard = new InlineKeyboard()
    .webApp('📋 Посмотреть услуги', `${WEBAPP_URL}?slug=${slug}`);

  await ctx.reply(
    `💅 *${master.name}*\n` +
    (master.speciality ? `${master.speciality}` : '') +
    (master.address ? `\n📍 ${master.address}` : '') +
    '\n\nНажмите кнопку ниже, чтобы записаться:',
    {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    }
  );
}

// ===========================================
// Регистрация мастера: состояние
// ===========================================

// Храним состояния регистрации в памяти (для простоты)
const registrationState = {};

// ===========================================
// Выбор роли: Я мастер
// ===========================================

bot.callbackQuery('role_master', async (ctx) => {
  await ctx.answerCallbackQuery();

  // Проверяем, может уже зарегистрирован
  const existing = await db.findMasterByTgId(ctx.from.id);
  if (existing) {
    return showMasterDashboard(ctx, existing);
  }

  registrationState[ctx.from.id] = { step: 'await_name' };

  await ctx.editMessageText(
    '💅 Отлично! Давайте создадим ваш профиль мастера.\n\n' +
    '✏️ Напишите ваше имя и фамилию:\n' +
    'Например: *Анна Иванова*',
    { parse_mode: 'Markdown' }
  );
});

// ===========================================
// Выбор роли: Я клиент
// ===========================================

bot.callbackQuery('role_client', async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(
    '👋 Добро пожаловать!\n\n' +
    'Чтобы записаться к мастеру, перейдите по ссылке, которую вам прислал мастер.\n\n' +
    'Ссылка выглядит так:\n' +
    '`t.me/tg_beautybot?start=m_имя_мастера`',
    { parse_mode: 'Markdown' }
  );
});

bot.on('message:text', async (ctx) => {
  const state = registrationState[ctx.from.id];
  if (!state) return; // Нет активной регистрации

  if (state.step === 'await_name') {
    state.name = ctx.message.text.trim();
    state.step = 'await_speciality';

    await ctx.reply(
      `👍 Отлично, *${state.name}*!\n\n` +
      '✏️ Теперь напишите вашу специальность:\n' +
      'Например: *Маникюр, Педикюр*',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  if (state.step === 'await_speciality') {
    state.speciality = ctx.message.text.trim();

    // Создаём мастера в БД
    const slug = generateSlug(state.name, ctx.from.id);

    try {
      const master = await db.createMaster({
        telegramId: ctx.from.id,
        username: ctx.from.username || null,
        slug,
        name: state.name,
        speciality: state.speciality,
      });

      delete registrationState[ctx.from.id];

      const shareLink = `https://t.me/tg_beautybot?start=m_${slug}`;

      await ctx.reply(
        '🎉 *Профиль создан!*\n\n' +
        `👤 ${master.name}\n` +
        `💅 ${master.speciality}\n\n` +
        '📎 Ваша ссылка для клиентов:\n' +
        `\`${shareLink}\`\n\n` +
        'Отправьте эту ссылку клиентам — по ней они попадут в ваш каталог услуг.\n\n' +
        '👉 Следующий шаг: добавьте услуги через /master',
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      delete registrationState[ctx.from.id];
      console.error('Ошибка регистрации:', err);
      await ctx.reply('😔 Произошла ошибка при регистрации. Попробуйте /start ещё раз.');
    }
    return;
  }
});

// ===========================================
// /master — дашборд мастера
// ===========================================

bot.command('master', async (ctx) => {
  const master = await db.findMasterByTgId(ctx.from.id);
  if (!master) {
    return ctx.reply('Вы не зарегистрированы как мастер. Нажмите /start');
  }
  return showMasterDashboard(ctx, master);
});

async function showMasterDashboard(ctx, master) {
  const services = await db.getServicesByMaster(master.id);
  const today = new Date().toISOString().slice(0, 10);
  const todayBookings = await db.getBookingsByMaster(master.id, today);

  const shareLink = `https://t.me/tg_beautybot?start=m_${master.slug}`;

  let text = `💅 *${master.name}*\n`;
  text += master.speciality ? `${master.speciality}\n` : '';
  text += `\n📊 Услуг: ${services.length} | Записей сегодня: ${todayBookings.length}\n`;
  text += `📋 Тариф: ${master.plan === 'pro' ? 'PRO ⭐' : 'Бесплатный'}\n`;
  text += `\n📎 Ссылка для клиентов:\n\`${shareLink}\``;

  if (todayBookings.length > 0) {
    text += '\n\n📅 *Записи на сегодня:*';
    for (const b of todayBookings) {
      const statusIcon = b.status === 'confirmed' ? '✅' : b.status === 'pending' ? '⏳' : '❓';
      text += `\n${statusIcon} ${b.time.slice(0, 5)} — ${b.client_name}`;
    }
  }

  const keyboard = new InlineKeyboard()
    .webApp('⚙️ Управление услугами', `${WEBAPP_URL}/admin?master=${master.slug}`)
    .row()
    .text('📋 Мои записи', 'my_bookings')
    .text('📊 Статистика', 'my_stats');

  await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
}

// ===========================================
// Callback: подтверждение/отмена записи
// ===========================================

bot.callbackQuery(/^booking_(confirm|cancel)_(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();

  const action = ctx.match[1]; // 'confirm' или 'cancel'
  const bookingId = ctx.match[2];

  const newStatus = action === 'confirm' ? 'confirmed' : 'cancelled';
  await db.updateBookingStatus(bookingId, newStatus);

  const booking = await db.getBookingById(bookingId);
  if (!booking) return;

  // Обновляем сообщение у мастера
  const statusText = action === 'confirm' ? '✅ Подтверждено' : '❌ Отменено';
  await ctx.editMessageText(
    ctx.message.text + `\n\n${statusText}`,
    { parse_mode: 'Markdown' }
  );

  // Уведомляем клиента
  try {
    if (action === 'confirm') {
      await bot.api.sendMessage(booking.client_tg_id,
        `✅ Ваша запись подтверждена!\n\n` +
        `${booking.services?.emoji || '💅'} ${booking.services?.name || 'Услуга'}\n` +
        `📅 ${booking.date} в ${booking.time.slice(0, 5)}\n` +
        (booking.masters?.address ? `📍 ${booking.masters.address}\n` : '') +
        `\nМастер: ${booking.masters?.name || 'Мастер'}`
      );
    } else {
      await bot.api.sendMessage(booking.client_tg_id,
        `❌ К сожалению, мастер отменил вашу запись.\n\n` +
        `${booking.services?.emoji || '💅'} ${booking.services?.name || 'Услуга'}\n` +
        `📅 ${booking.date} в ${booking.time.slice(0, 5)}\n\n` +
        `Попробуйте выбрать другое время.`
      );
    }
  } catch (err) {
    console.error('Не удалось уведомить клиента:', err.message);
  }
});

// ===========================================
// Получение данных из Mini App (запись клиента)
// ===========================================

bot.on('message:web_app_data', async (ctx) => {
  try {
    const data = JSON.parse(ctx.message.web_app_data.data);
    console.log('📥 Получены данные записи:', data);

    // Находим мастера по slug
    const master = await db.findMasterBySlug(data.slug);
    if (!master) {
      return ctx.reply('😔 Мастер не найден. Попробуйте ещё раз.');
    }

    // Вычисляем end_time
    const [hours, minutes] = data.time.split(':').map(Number);
    const endMinutes = hours * 60 + minutes + (data.duration || 60);
    const endTime = String(Math.floor(endMinutes / 60)).padStart(2, '0') + ':' +
                    String(endMinutes % 60).padStart(2, '0');

    // Сохраняем запись в БД
    const booking = await db.createBooking({
      masterId: master.id,
      serviceId: data.serviceId,
      clientTgId: ctx.from.id,
      clientName: data.userName || ctx.from.first_name,
      clientUsername: data.userUsername || ctx.from.username || null,
      date: data.date,
      time: data.time,
      endTime: endTime,
    });

    // Подтверждение клиенту
    await ctx.reply(
      '✅ *Запись создана!*\n\n' +
      `${data.serviceName || 'Услуга'}\n` +
      `📅 ${data.date} в ${data.time}\n` +
      `💰 ${data.price ? data.price.toLocaleString('ru') + ' ₽' : ''}\n` +
      (master.address ? `📍 ${master.address}\n` : '') +
      `\nМастер: ${master.name}\n\n` +
      '⏳ Ожидайте подтверждения от мастера.',
      { parse_mode: 'Markdown' }
    );

    // Уведомление мастеру
    const confirmKeyboard = new InlineKeyboard()
      .text('✅ Подтвердить', `booking_confirm_${booking.id}`)
      .text('❌ Отменить', `booking_cancel_${booking.id}`);

    await bot.api.sendMessage(master.telegram_id,
      '📥 *Новая запись!*\n\n' +
      `👤 ${data.userName || 'Клиент'}` +
      (data.userUsername ? ` (@${data.userUsername})` : '') + '\n' +
      `${data.serviceName || 'Услуга'}\n` +
      `📅 ${data.date} в ${data.time}–${endTime}\n` +
      `💰 ${data.price ? data.price.toLocaleString('ru') + ' ₽' : ''}`,
      { parse_mode: 'Markdown', reply_markup: confirmKeyboard }
    );

    console.log('✅ Запись сохранена:', booking.id);
  } catch (err) {
    console.error('❌ Ошибка обработки записи:', err);
    await ctx.reply('😔 Произошла ошибка при создании записи. Попробуйте ещё раз.');
  }
});

// ===========================================
// Callback: мои записи
// ===========================================

bot.callbackQuery('my_bookings', async (ctx) => {
  await ctx.answerCallbackQuery();

  const master = await db.findMasterByTgId(ctx.from.id);
  if (!master) return;

  const bookings = await db.getBookingsByMaster(master.id);

  if (bookings.length === 0) {
    return ctx.editMessageText('📋 У вас пока нет записей.');
  }

  let text = '📋 *Ваши записи:*\n';
  for (const b of bookings) {
    const statusIcon = b.status === 'confirmed' ? '✅' :
                       b.status === 'pending' ? '⏳' : '❓';
    text += `\n${statusIcon} ${b.date} ${b.time.slice(0, 5)} — ${b.client_name}`;
  }

  await ctx.editMessageText(text, { parse_mode: 'Markdown' });
});

// ===========================================
// Callback: статистика
// ===========================================

bot.callbackQuery('my_stats', async (ctx) => {
  await ctx.answerCallbackQuery();

  const master = await db.findMasterByTgId(ctx.from.id);
  if (!master) return;

  const services = await db.getServicesByMaster(master.id);
  const allBookings = await db.getBookingsByMaster(master.id);
  const confirmed = allBookings.filter(b => b.status === 'confirmed').length;
  const pending = allBookings.filter(b => b.status === 'pending').length;

  let text = '📊 *Статистика:*\n\n';
  text += `💅 Услуг: ${services.length}\n`;
  text += `📋 Всего записей: ${allBookings.length}\n`;
  text += `✅ Подтверждённых: ${confirmed}\n`;
  text += `⏳ Ожидают: ${pending}\n`;
  text += `\n📋 Тариф: ${master.plan === 'pro' ? 'PRO ⭐' : 'Бесплатный'}`;

  await ctx.editMessageText(text, { parse_mode: 'Markdown' });
});

// ===========================================
// /reset — сброс регистрации (для тестирования)
// ===========================================

bot.command('reset', async (ctx) => {
  const master = await db.findMasterByTgId(ctx.from.id);

  if (!master) {
    return ctx.reply('Вы не зарегистрированы. Нажмите /start чтобы начать.');
  }

  const keyboard = new InlineKeyboard()
    .text('✅ Да, сбросить', 'confirm_reset')
    .text('❌ Отмена', 'cancel_reset');

  await ctx.reply(
    '⚠️ *Сброс регистрации*\n\n' +
    `Мастер: ${master.name}\n` +
    'Это удалит вашу регистрацию как мастера.\n' +
    'Услуги и записи сохранятся в базе.\n\n' +
    'После сброса вы сможете заново пройти /start и выбрать роль.',
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
});

bot.callbackQuery('confirm_reset', async (ctx) => {
  await ctx.answerCallbackQuery();

  try {
    await db.resetMaster(ctx.from.id);
    await ctx.editMessageText(
      '✅ Регистрация сброшена!\n\nНажмите /start чтобы начать заново.'
    );
  } catch (e) {
    await ctx.editMessageText('❌ Ошибка при сбросе: ' + e.message);
  }
});

bot.callbackQuery('cancel_reset', async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText('Сброс отменён. Всё как было 👌');
});

// ===========================================
// /help
// ===========================================

bot.command('help', async (ctx) => {
  await ctx.reply(
    '📖 *Команды бота:*\n\n' +
    '/start — начать работу\n' +
    '/master — панель мастера\n' +
    '/reset — сбросить регистрацию\n' +
    '/help — эта справка\n\n' +
    '*Для мастеров:*\n' +
    '1. Зарегистрируйтесь через /start → «Я мастер»\n' +
    '2. Добавьте услуги через /master\n' +
    '3. Отправьте ссылку клиентам\n\n' +
    '*Для клиентов:*\n' +
    'Перейдите по ссылке от мастера, чтобы записаться.',
    { parse_mode: 'Markdown' }
  );
});

module.exports = { bot };
