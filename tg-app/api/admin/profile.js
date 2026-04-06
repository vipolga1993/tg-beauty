// Vercel Serverless Function: Admin Profile
// GET /api/admin/profile — получить профиль мастера
// PUT /api/admin/profile — обновить профиль мастера

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

  // Authenticate user from initData (HMAC validation)
  const initData = req.headers['x-init-data'];
  const user = authenticateUser(initData, process.env.BOT_TOKEN);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Find master by telegram_id
    const masterRes = await fetch(
      `${SUPABASE_URL}/rest/v1/masters?telegram_id=eq.${user.id}&limit=1`,
      { headers }
    );
    const masters = await masterRes.json();
    if (!masters || masters.length === 0) {
      return res.status(404).json({ error: 'Master not found' });
    }
    const master = masters[0];

    // GET — return profile
    if (req.method === 'GET') {
      return res.status(200).json(master);
    }

    // PUT — update profile
    if (req.method === 'PUT') {
      const data = req.body;
      const allowed = {};
      if (data.name !== undefined) allowed.name = data.name;
      if (data.speciality !== undefined) allowed.speciality = data.speciality;
      if (data.address !== undefined) allowed.address = data.address;
      if (data.phone !== undefined) allowed.phone = data.phone;
      if (data.experience !== undefined) allowed.experience = data.experience;

      if (Object.keys(allowed).length === 0) {
        return res.status(400).json({ error: 'No fields to update' });
      }

      const updateRes = await fetch(
        `${SUPABASE_URL}/rest/v1/masters?id=eq.${master.id}`,
        {
          method: 'PATCH',
          headers: { ...headers, 'Prefer': 'return=representation' },
          body: JSON.stringify(allowed),
        }
      );

      if (!updateRes.ok) {
        const err = await updateRes.json();
        return res.status(500).json({ error: err.message || 'Update failed' });
      }

      const updated = await updateRes.json();
      return res.status(200).json(updated[0]);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Admin profile error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

