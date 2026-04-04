const TOKEN = process.env.BOT_TOKEN || '8614192937:AAEjrBcR1XYR4NsX_qha0Wp_9ydv_qdD8-M';
const API = `https://api.telegram.org/bot${TOKEN}`;

async function call(method, body) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  console.log(`${method}:`, data.ok ? 'OK' : data.description);
  return data;
}

async function main() {
  // 1. Описание бота (видно при первом открытии)
  await call('setMyDescription', {
    description: '\u041e\u043d\u043b\u0430\u0439\u043d-\u0437\u0430\u043f\u0438\u0441\u044c \u043a \u0431\u044c\u044e\u0442\u0438-\u043c\u0430\u0441\u0442\u0435\u0440\u0443 \u0410\u043d\u043d\u0435 \u0418\u0432\u0430\u043d\u043e\u0432\u043e\u0439. \u0412\u044b\u0431\u0438\u0440\u0430\u0439\u0442\u0435 \u0443\u0441\u043b\u0443\u0433\u0443, \u0443\u0434\u043e\u0431\u043d\u0443\u044e \u0434\u0430\u0442\u0443 \u0438 \u0432\u0440\u0435\u043c\u044f \u2014 \u0432\u0441\u0451 \u0437\u0430 \u043f\u0430\u0440\u0443 \u043d\u0430\u0436\u0430\u0442\u0438\u0439 \u043f\u0440\u044f\u043c\u043e \u0432 Telegram. \u041d\u0430\u0436\u043c\u0438\u0442\u0435 \u00ab\u041c\u0435\u043d\u044e\u00bb \u0432\u043d\u0438\u0437\u0443, \u0447\u0442\u043e\u0431\u044b \u043e\u0442\u043a\u0440\u044b\u0442\u044c \u043a\u0430\u0442\u0430\u043b\u043e\u0433.',
    language_code: 'ru',
  });

  // 2. Короткое описание (в профиле бота)
  await call('setMyShortDescription', {
    short_description: '\u0417\u0430\u043f\u0438\u0441\u044c \u043a \u0431\u044c\u044e\u0442\u0438-\u043c\u0430\u0441\u0442\u0435\u0440\u0443 \u2014 \u043c\u0430\u043d\u0438\u043a\u044e\u0440, \u043f\u0435\u0434\u0438\u043a\u044e\u0440, \u0443\u0445\u043e\u0434. \u0411\u044b\u0441\u0442\u0440\u043e \u0438 \u0443\u0434\u043e\u0431\u043d\u043e.',
    language_code: 'ru',
  });

  // 3. Команды бота
  await call('setMyCommands', {
    commands: [
      { command: 'start', description: '\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u043a\u0430\u0442\u0430\u043b\u043e\u0433 \u0443\u0441\u043b\u0443\u0433' },
      { command: 'help', description: '\u041a\u0430\u043a \u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u044c\u0441\u044f \u0431\u043e\u0442\u043e\u043c' },
      { command: 'contact', description: '\u0421\u0432\u044f\u0437\u0430\u0442\u044c\u0441\u044f \u0441 \u043c\u0430\u0441\u0442\u0435\u0440\u043e\u043c' },
    ],
    language_code: 'ru',
  });

  // 4. Кнопка Menu -> Mini App
  await call('setChatMenuButton', {
    menu_button: {
      type: 'web_app',
      text: '\u0417\u0430\u043f\u0438\u0441\u0430\u0442\u044c\u0441\u044f',
      web_app: { url: 'https://tg-app-tan.vercel.app' },
    },
  });
}

main();
