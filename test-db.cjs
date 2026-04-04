// Проверка подключения к Supabase
// Запуск: node test-db.js

require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function testConnection() {
  console.log('--- Проверка подключения к Supabase ---\n');
  console.log('URL:', SUPABASE_URL);
  console.log('Key:', SUPABASE_KEY ? SUPABASE_KEY.slice(0, 20) + '...' : 'НЕ НАЙДЕН!\n');

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Ошибка: не заданы SUPABASE_URL или SUPABASE_SERVICE_KEY в .env');
    process.exit(1);
  }

  // 1. Проверяем таблицы через REST API
  console.log('\n1. Проверяю таблицу masters...');
  var res = await fetch(SUPABASE_URL + '/rest/v1/masters?select=id&limit=1', {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
    }
  });
  console.log('   Статус:', res.status, res.status === 200 ? 'OK' : 'ОШИБКА');

  console.log('\n2. Проверяю таблицу services...');
  res = await fetch(SUPABASE_URL + '/rest/v1/services?select=id&limit=1', {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
    }
  });
  console.log('   Статус:', res.status, res.status === 200 ? 'OK' : 'ОШИБКА');

  console.log('\n3. Проверяю таблицу bookings...');
  res = await fetch(SUPABASE_URL + '/rest/v1/bookings?select=id&limit=1', {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
    }
  });
  console.log('   Статус:', res.status, res.status === 200 ? 'OK' : 'ОШИБКА');

  console.log('\n4. Проверяю Storage (portfolio bucket)...');
  res = await fetch(SUPABASE_URL + '/storage/v1/bucket/portfolio', {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
    }
  });
  var bucket = await res.json();
  if (bucket.name === 'portfolio') {
    console.log('   Бакет portfolio:', 'OK (публичный:', bucket.public, ')');
  } else {
    console.log('   Бакет portfolio: НЕ НАЙДЕН — создай его в Supabase Dashboard → Storage');
  }

  // 5. Тест записи — создаём тестового мастера
  console.log('\n5. Тест записи: создаю тестового мастера...');
  res = await fetch(SUPABASE_URL + '/rest/v1/masters', {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify({
      telegram_id: 999999999,
      slug: 'test_master',
      name: 'Тестовый Мастер',
      speciality: 'Тест',
    }),
  });

  if (res.status === 201) {
    var master = (await res.json())[0];
    console.log('   Мастер создан! ID:', master.id);

    // Проверяем автоматическое расписание
    console.log('\n6. Проверяю автоматическое расписание...');
    res = await fetch(SUPABASE_URL + '/rest/v1/schedule?master_id=eq.' + master.id + '&select=day_of_week,start_time,end_time,is_working&order=day_of_week', {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
      }
    });
    var schedule = await res.json();
    console.log('   Дней в расписании:', schedule.length, schedule.length === 7 ? 'OK' : 'ОШИБКА');

    // Удаляем тестового мастера
    console.log('\n7. Удаляю тестового мастера...');
    res = await fetch(SUPABASE_URL + '/rest/v1/masters?id=eq.' + master.id, {
      method: 'DELETE',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
      }
    });
    console.log('   Удалён:', res.status === 204 ? 'OK' : 'ОШИБКА');
  } else {
    var err = await res.json();
    console.log('   Ошибка создания:', JSON.stringify(err));
  }

  console.log('\n--- Проверка завершена ---');
}

testConnection().catch(function(e) { console.error('Ошибка:', e.message); });
