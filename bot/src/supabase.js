// Supabase REST API клиент (без SDK — легче и проще)

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const headers = {
  'apikey': SUPABASE_KEY,
  'Authorization': 'Bearer ' + SUPABASE_KEY,
  'Content-Type': 'application/json',
};

// --- Универсальные методы ---

async function query(table, params = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, { headers });
  if (!res.ok) throw new Error(`Supabase GET ${table}: ${res.status}`);
  return res.json();
}

async function insert(table, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...headers, 'Prefer': 'return=representation' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Supabase INSERT ${table}: ${err.message || JSON.stringify(err)}`);
  }
  return (await res.json())[0];
}

async function update(table, filter, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: { ...headers, 'Prefer': 'return=representation' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Supabase UPDATE ${table}: ${res.status}`);
  return res.json();
}

// --- Мастера ---

async function findMasterByTgId(telegramId) {
  const rows = await query('masters', `telegram_id=eq.${telegramId}&limit=1`);
  return rows[0] || null;
}

async function findMasterBySlug(slug) {
  const rows = await query('masters', `slug=eq.${slug}&limit=1`);
  return rows[0] || null;
}

async function createMaster({ telegramId, username, slug, name, speciality }) {
  return insert('masters', {
    telegram_id: telegramId,
    username,
    slug,
    name,
    speciality,
  });
}

// --- Услуги ---

async function getServicesByMaster(masterId) {
  return query('services', `master_id=eq.${masterId}&is_active=eq.true&order=sort_order`);
}

async function countActiveServices(masterId) {
  const rows = await query('services', `master_id=eq.${masterId}&is_active=eq.true&select=id`);
  return rows.length;
}

// --- Записи ---

async function createBooking({ masterId, serviceId, clientTgId, clientName, clientUsername, date, time, endTime }) {
  return insert('bookings', {
    master_id: masterId,
    service_id: serviceId,
    client_tg_id: clientTgId,
    client_name: clientName,
    client_username: clientUsername,
    date,
    time,
    end_time: endTime,
    status: 'pending',
  });
}

async function getBookingsByMaster(masterId, date) {
  let params = `master_id=eq.${masterId}&status=neq.cancelled&order=time`;
  if (date) params += `&date=eq.${date}`;
  return query('bookings', params);
}

async function updateBookingStatus(bookingId, status) {
  return update('bookings', `id=eq.${bookingId}`, { status });
}

async function getBookingById(bookingId) {
  const rows = await query('bookings', `id=eq.${bookingId}&select=*,services(name,emoji,price,duration),masters(name,telegram_id,address)`);
  return rows[0] || null;
}

// --- Расписание ---

async function getSchedule(masterId, dayOfWeek) {
  const rows = await query('schedule', `master_id=eq.${masterId}&day_of_week=eq.${dayOfWeek}&limit=1`);
  return rows[0] || null;
}

async function resetMaster(telegramId) {
  // Обнуляем telegram_id вместо удаления — так не ломаются внешние ключи
  const res = await fetch(`${SUPABASE_URL}/rest/v1/masters?telegram_id=eq.${telegramId}`, {
    method: 'PATCH',
    headers: { ...headers, 'Prefer': 'return=representation' },
    body: JSON.stringify({ telegram_id: null }),
  });
  if (!res.ok) throw new Error(`Supabase PATCH masters: ${res.status}`);
  const result = await res.json();
  if (!result || result.length === 0) throw new Error('Мастер не найден');
}

module.exports = {
  findMasterByTgId,
  findMasterBySlug,
  createMaster,
  getServicesByMaster,
  countActiveServices,
  createBooking,
  getBookingsByMaster,
  updateBookingStatus,
  getBookingById,
  getSchedule,
  resetMaster,
};
