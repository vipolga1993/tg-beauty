// ==========================================
// CRM-бот для мастеров — Google Apps Script
// Мультимастерная версия: у каждого мастера своя вкладка
// Режим: POLLING (не webhook — без проблем с 302)
// ==========================================
// Как запустить:
// 1. Вставь код в Apps Script
// 2. Запусти setupBot() ОДИН РАЗ — удалит вебхук и создаст триггер
// ==========================================

const CRM_BOT_TOKEN = 'ВСТАВЬ_ТОКЕН_СЮДА'; // получить у @BotFather
const SPREADSHEET_ID = 'ВСТАВЬ_ID_ТАБЛИЦЫ_СЮДА'; // из URL Google Sheets

// ==========================================
// POLLING — запускается триггером каждую минуту
// ==========================================
function pollUpdates() {
  const props = PropertiesService.getScriptProperties();
  let offset = parseInt(props.getProperty('offset') || '0');

  const url = 'https://api.telegram.org/bot' + CRM_BOT_TOKEN +
    '/getUpdates?timeout=0&offset=' + offset;
  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const data = JSON.parse(response.getContentText());

  if (!data.ok || !data.result.length) return;

  for (const update of data.result) {
    offset = update.update_id + 1;
    if (!update.message) continue;

    const msg = update.message;
    const chatId = msg.chat.id;
    const text = (msg.text || '').trim();
    const firstName = msg.from.first_name || '';
    const lastName = msg.from.last_name || '';
    const username = msg.from.username || '';
    const masterName = (firstName + ' ' + lastName).trim() || username || String(chatId);

    ensureMasterSheet(chatId, masterName);

    if (text.startsWith('/')) {
      handleCommand(chatId, text);
    } else if (text.length > 0) {
      handleRecord(chatId, text);
    }
  }

  props.setProperty('offset', String(offset));
}

// ==========================================
// УПРАВЛЕНИЕ ВКЛАДКАМИ МАСТЕРОВ
// ==========================================

function getSheetName(chatId) {
  const registry = getRegistry();
  return registry[String(chatId)] || null;
}

function ensureMasterSheet(chatId, masterName) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const registry = getRegistry();
  const key = String(chatId);

  if (registry[key]) return;

  const safeName = masterName.replace(/[^\wА-Яа-яЁё ]/g, '').substring(0, 15).trim();
  const sheetName = safeName + '_' + String(chatId).slice(-4);

  const sheet = ss.insertSheet(sheetName);
  const headers = [['Дата', 'Имя клиента', 'Услуга', 'Сумма (₽)', 'Комментарий']];
  sheet.getRange(1, 1, 1, 5).setValues(headers);

  const hRange = sheet.getRange(1, 1, 1, 5);
  hRange.setBackground('#4a4a8a');
  hRange.setFontColor('#ffffff');
  hRange.setFontWeight('bold');
  hRange.setFontSize(11);
  sheet.setColumnWidth(1, 100);
  sheet.setColumnWidth(2, 150);
  sheet.setColumnWidth(3, 150);
  sheet.setColumnWidth(4, 100);
  sheet.setColumnWidth(5, 200);
  sheet.setFrozenRows(1);

  registry[key] = sheetName;
  saveRegistry(registry);

  sendMessage(chatId,
    '👋 Привет, ' + masterName + '! Я создал твою личную таблицу клиентов.\n\n' +
    '📝 Как добавить клиента:\n' +
    'Просто напиши: Имя Услуга Сумма\n' +
    'Пример: Аня маникюр 1500\n\n' +
    '📊 Команды:\n' +
    '/доход — доход за этот месяц\n' +
    '/клиенты — кто давно не приходил\n' +
    '/старт — это меню'
  );
}

function getRegistry() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName('_registry');
  if (!sheet) {
    sheet = ss.insertSheet('_registry');
    sheet.getRange(1, 1, 1, 2).setValues([['chat_id', 'sheet_name']]);
    sheet.hideSheet();
    return {};
  }
  const data = sheet.getDataRange().getValues();
  const registry = {};
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) registry[String(data[i][0])] = data[i][1];
  }
  return registry;
}

function saveRegistry(registry) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName('_registry');
  if (!sheet) {
    sheet = ss.insertSheet('_registry');
    sheet.hideSheet();
  }
  sheet.clearContents();
  const rows = [['chat_id', 'sheet_name']];
  for (const [id, name] of Object.entries(registry)) {
    rows.push([id, name]);
  }
  sheet.getRange(1, 1, rows.length, 2).setValues(rows);
}

// ==========================================
// ОБРАБОТКА СООБЩЕНИЙ
// ==========================================

function handleRecord(chatId, text) {
  const parts = text.replace(/,/g, ' ').trim().split(/\s+/);
  if (parts.length < 2) {
    sendMessage(chatId,
      '❌ Не понял формат. Напиши так:\n' +
      'Имя Услуга Сумма\n\n' +
      'Пример: Аня маникюр 1500\n\n' +
      'Или /старт чтобы увидеть все команды'
    );
    return;
  }

  const name = parts[0];
  const lastPart = parseFloat(parts[parts.length - 1]);
  const hasAmount = !isNaN(lastPart);
  const service = hasAmount ? parts.slice(1, -1).join(' ') : parts.slice(1).join(' ');
  const amount = hasAmount ? lastPart : 0;

  const sheetName = getSheetName(chatId);
  if (!sheetName) {
    sendMessage(chatId, '❌ Ошибка: твоя таблица не найдена. Напиши /старт');
    return;
  }
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(sheetName);
  const date = new Date();
  const dateStr = Utilities.formatDate(date, 'Europe/Moscow', 'dd.MM.yyyy');

  sheet.appendRow([dateStr, name, service, amount, '']);

  sendMessage(chatId,
    '✅ Записано!\n' +
    '👤 ' + name + '\n' +
    '💅 ' + service + '\n' +
    (hasAmount ? '💰 ' + amount + '₽\n' : '') +
    '📅 ' + dateStr
  );
}

function handleCommand(chatId, text) {
  const cmd = text.split(' ')[0].toLowerCase();
  if (cmd === '/доход') sendIncome(chatId);
  else if (cmd === '/клиенты') sendLostClients(chatId);
  else if (cmd === '/start' || cmd === '/старт') {
    sendMessage(chatId,
      '📋 Команды:\n\n' +
      '📝 Добавить клиента:\nНапиши Имя Услуга Сумма\nПример: Аня маникюр 1500\n\n' +
      '/доход — доход за этот месяц\n' +
      '/клиенты — кто давно не приходил'
    );
  }
}

// ==========================================
// ОТЧЁТЫ
// ==========================================

function sendIncome(chatId) {
  const sheetName = getSheetName(chatId);
  if (!sheetName) { sendMessage(chatId, '❌ Таблица не найдена. Напиши /старт'); return; }
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(sheetName);
  const data = sheet.getDataRange().getValues();
  const now = new Date();
  let total = 0, count = 0;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;
    const parts = row[0].toString().split('.');
    if (parts.length < 3) continue;
    const rowDate = new Date(parts[2], parts[1] - 1, parts[0]);
    if (rowDate.getMonth() === now.getMonth() && rowDate.getFullYear() === now.getFullYear()) {
      total += parseFloat(row[3]) || 0;
      count++;
    }
  }

  const month = now.toLocaleString('ru-RU', { month: 'long' });
  sendMessage(chatId,
    '📊 Доход за ' + month + ':\n\n' +
    '💰 Сумма: ' + total + '₽\n' +
    '👥 Клиентов: ' + count + '\n' +
    '📅 Средний чек: ' + (count > 0 ? Math.round(total / count) : 0) + '₽'
  );
}

function sendLostClients(chatId) {
  const sheetName = getSheetName(chatId);
  if (!sheetName) { sendMessage(chatId, '❌ Таблица не найдена. Напиши /старт'); return; }
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(sheetName);
  const data = sheet.getDataRange().getValues();
  const clients = {};

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0] || !row[1]) continue;
    const parts = row[0].toString().split('.');
    if (parts.length < 3) continue;
    const rowDate = new Date(parts[2], parts[1] - 1, parts[0]);
    const name = row[1].toString();
    if (!clients[name] || rowDate > clients[name]) clients[name] = rowDate;
  }

  const now = new Date();
  const lost = [];
  for (const [name, lastVisit] of Object.entries(clients)) {
    const days = Math.floor((now - lastVisit) / 86400000);
    if (days >= 30) lost.push({ name, days });
  }

  if (lost.length === 0) {
    sendMessage(chatId, '✅ Все клиенты приходили в последние 30 дней!');
    return;
  }

  lost.sort((a, b) => b.days - a.days);
  let msg = '⚠️ Давно не приходили:\n\n';
  lost.forEach(c => { msg += '👤 ' + c.name + ' — ' + c.days + ' дней назад\n'; });
  msg += '\n💡 Напиши им, напомни о себе!';
  sendMessage(chatId, msg);
}

// ==========================================
// УТИЛИТЫ
// ==========================================

function sendMessage(chatId, text) {
  UrlFetchApp.fetch('https://api.telegram.org/bot' + CRM_BOT_TOKEN + '/sendMessage', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ chat_id: chatId, text: text }),
    muteHttpExceptions: true
  });
}

// Запусти ОДИН РАЗ — удалит вебхук и создаст триггер опроса каждую минуту
function setupBot() {
  // Удаляем вебхук
  UrlFetchApp.fetch('https://api.telegram.org/bot' + CRM_BOT_TOKEN + '/deleteWebhook');

  // Удаляем старые триггеры если есть
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));

  // Создаём триггер каждую минуту
  ScriptApp.newTrigger('pollUpdates')
    .timeBased()
    .everyMinutes(1)
    .create();

  // Сбрасываем offset
  PropertiesService.getScriptProperties().setProperty('offset', '0');

  // Создаём реестр если нет
  getRegistry();

  Logger.log('Готово! Бот запущен в режиме polling. Проверяет сообщения каждую минуту.');
}
