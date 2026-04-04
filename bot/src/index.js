// Точка входа бота
// Запуск: npm run dev (из папки bot/)

// Локально читаем .env из корня проекта, на Railway — переменные из Dashboard
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
require('dotenv').config(); // fallback: .env рядом с bot/

const { bot } = require('./bot');

// Запуск в режиме long polling (для разработки)
// На продакшене заменить на webhook
bot.start({
  onStart: (botInfo) => {
    console.log('');
    console.log('===========================================');
    console.log(`  🤖 Бот @${botInfo.username} запущен!`);
    console.log('===========================================');
    console.log('');
    console.log('  Команды:');
    console.log('  /start     — начать работу');
    console.log('  /master    — панель мастера');
    console.log('  /help      — справка');
    console.log('');
    console.log('  Нажми Ctrl+C чтобы остановить');
    console.log('');
  },
});

// Красивое завершение
process.once('SIGINT', () => bot.stop());
process.once('SIGTERM', () => bot.stop());
