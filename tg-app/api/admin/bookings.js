// Vercel Serverless Function: Admin Bookings
// GET /api/admin/bookings          — записи мастера (фильтры: status, date)
// PUT /api/admin/bookings          — подтвердить/отменить запись

import { authenticateUser } from '../lib/validate-init-data.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Init-Data');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const BOT_TOKEN = process.env.BOT_TOKEN;

  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY,
    'Content-Type': 'application/json',
  };

  const initData = req.headers['x-init-data'];
  const user = authenticateUser(initData, process.env.BOT_TOKEN);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Find master
    const masterRes = await fetch(
      `${SUPABASE_URL}/rest/v1/masters?telegram_id=eq.${user.id}&limit=1`,
      { headers }
    );
    const masters = await masterRes.json();
    if (!masters || masters.length === 0) {
      return res.status(404).json({ error: 'Master not found' });
    }
    const master = masters[0];

    // --- GET: list bookings ---
    if (req.method === 'GET') {
      let query = `${SUPABASE_URL}/rest/v1/bookings?master_id=eq.${master.id}&order=date.asc,time.asc`;

      // Filter by status
      if (req.query.status) {
        query += `&status=eq.${req.query.status}`;
      }

      // Filter by date
      if (req.query.date) {
        query += `&date=eq.${req.query.date}`;
      }

      // Filter: upcoming (today and future)
      if (req.query.upcoming === 'true') {
        const today = new Date().toISOString().slice(0, 10);
        query += `&date=gte.${today}`;
      }

      const bRes = await fetch(query, { headers });
      const bookings = await bRes.json();

      // Enrich with service names
      if (bookings.length > 0) {
        const serviceIds = [...new Set(bookings.map(b => b.service_id))];
        const svcQuery = serviceIds.map(id => `id.eq.${id}`).join(',');
        const svcRes = await fetch(
          `${SUPABASE_URL}/rest/v1/services?or=(${svcQuery})&select=id,name,emoji,price,duration`,
          { headers }
        );
        const services = await svcRes.json();
        const svcMap = {};
        if (Array.isArray(services)) {
          services.forEach(s => { svcMap[s.id] = s; });
        }

        bookings.forEach(b => {
          const svc = svcMap[b.service_id];
          if (svc) {
            b.service_name = svc.name;
            b.service_emoji = svc.emoji;
            b.service_price = svc.price;
            b.service_duration = svc.duration;
          }
        });
      }

      return res.status(200).json(bookings);
    }

    // --- PUT: confirm or cancel booking ---
    if (req.method === 'PUT') {
      const { bookingId, action } = req.body;
      if (!bookingId || !action) {
        return res.status(400).json({ error: 'bookingId and action required' });
      }

      if (!['confirmed', 'cancelled'].includes(action)) {
        return res.status(400).json({ error: 'action must be "confirmed" or "cancelled"' });
      }

      // Verify booking belongs to master
      const bRes = await fetch(
        `${SUPABASE_URL}/rest/v1/bookings?id=eq.${bookingId}&master_id=eq.${master.id}&limit=1`,
        { headers }
      );
      const bookings = await bRes.json();
      if (!bookings || bookings.length === 0) {
        return res.status(404).json({ error: 'Booking not found' });
      }

      const booking = bookings[0];

      // Update status
      await fetch(
        `${SUPABASE_URL}/rest/v1/bookings?id=eq.${bookingId}`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ status: action }),
        }
      );

      // Notify client via Telegram
      if (booking.client_tg_id && BOT_TOKEN) {
        let text;
        if (action === 'confirmed') {
          text = [
            '✅ Запись подтверждена!',
            '',
            (booking.service_name || 'Услуга'),
            '📅 ' + booking.date + ' в ' + booking.time.slice(0, 5),
            master.address ? '📍 ' + master.address : '',
            '',
            'Мастер: ' + master.name,
          ].filter(Boolean).join('\n');
        } else {
          text = [
            '❌ Запись отменена мастером',
            '',
            (booking.service_name || 'Услуга'),
            '📅 ' + booking.date + ' в ' + booking.time.slice(0, 5),
            '',
            'Вы можете выбрать другое время.',
          ].join('\n');
        }

        // Get service name for notification
        if (!booking.service_name) {
          const svcRes = await fetch(
            `${SUPABASE_URL}/rest/v1/services?id=eq.${booking.service_id}&limit=1`,
            { headers }
          );
          const svcs = await svcRes.json();
          if (svcs && svcs[0]) {
            text = text.replace('Услуга', svcs[0].name);
          }
        }

        await fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: booking.client_tg_id, text }),
        });
      }

      return res.status(200).json({ ok: true, status: action });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Admin bookings error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

