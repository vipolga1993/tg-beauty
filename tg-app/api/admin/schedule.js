// Vercel Serverless Function: Admin Schedule
// GET /api/admin/schedule — расписание мастера (7 дней)
// PUT /api/admin/schedule — обновить расписание

import { authenticateUser } from '../_lib/validate-init-data.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Init-Data');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

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

    // --- GET: schedule ---
    if (req.method === 'GET') {
      const schRes = await fetch(
        `${SUPABASE_URL}/rest/v1/schedule?master_id=eq.${master.id}&order=day_of_week`,
        { headers }
      );
      const schedule = await schRes.json();
      return res.status(200).json(schedule);
    }

    // --- PUT: update schedule ---
    if (req.method === 'PUT') {
      const days = req.body;
      if (!Array.isArray(days)) {
        return res.status(400).json({ error: 'Expected array of schedule days' });
      }

      // Update each day
      for (const day of days) {
        if (day.day_of_week === undefined) continue;

        const update = {};
        if (day.is_working !== undefined) update.is_working = day.is_working;
        if (day.start_time !== undefined) update.start_time = day.start_time;
        if (day.end_time !== undefined) update.end_time = day.end_time;
        if (day.slot_duration !== undefined) update.slot_duration = parseInt(day.slot_duration);

        if (Object.keys(update).length === 0) continue;

        await fetch(
          `${SUPABASE_URL}/rest/v1/schedule?master_id=eq.${master.id}&day_of_week=eq.${day.day_of_week}`,
          {
            method: 'PATCH',
            headers,
            body: JSON.stringify(update),
          }
        );
      }

      // Return updated schedule
      const schRes = await fetch(
        `${SUPABASE_URL}/rest/v1/schedule?master_id=eq.${master.id}&order=day_of_week`,
        { headers }
      );
      const schedule = await schRes.json();
      return res.status(200).json(schedule);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Admin schedule error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

