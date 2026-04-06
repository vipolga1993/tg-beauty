// Vercel Serverless Function: Admin Portfolio
// GET    /api/admin/portfolio         — список фото
// POST   /api/admin/portfolio         — загрузить фото (base64)
// DELETE /api/admin/portfolio?id=xxx  — удалить фото

import { authenticateUser } from '../_lib/validate-init-data.js';

const FREE_PORTFOLIO_LIMIT = 5;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
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

    // --- GET: list portfolio ---
    if (req.method === 'GET') {
      const pRes = await fetch(
        `${SUPABASE_URL}/rest/v1/portfolio?master_id=eq.${master.id}&order=sort_order,created_at`,
        { headers }
      );
      const portfolio = await pRes.json();
      return res.status(200).json({
        portfolio,
        plan: master.plan,
        limit: master.plan === 'free' ? FREE_PORTFOLIO_LIMIT : null,
      });
    }

    // --- POST: upload photo ---
    if (req.method === 'POST') {
      // Check FREE limit
      if (master.plan === 'free') {
        const countRes = await fetch(
          `${SUPABASE_URL}/rest/v1/portfolio?master_id=eq.${master.id}&select=id`,
          { headers }
        );
        const existing = await countRes.json();
        if (existing.length >= FREE_PORTFOLIO_LIMIT) {
          return res.status(403).json({
            error: 'Free plan limit reached',
            message: `На бесплатном тарифе максимум ${FREE_PORTFOLIO_LIMIT} фото. Перейдите на PRO.`,
          });
        }
      }

      const { image, caption } = req.body;
      if (!image) {
        return res.status(400).json({ error: 'image (base64) required' });
      }

      // Parse base64: "data:image/jpeg;base64,/9j/4AAQ..."
      const match = image.match(/^data:image\/(\w+);base64,(.+)$/);
      if (!match) {
        return res.status(400).json({ error: 'Invalid base64 image format' });
      }

      const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
      const base64Data = match[2];
      const buffer = Buffer.from(base64Data, 'base64');

      // Upload to Supabase Storage
      const fileName = `${master.id}/${Date.now()}.${ext}`;
      const uploadRes = await fetch(
        `${SUPABASE_URL}/storage/v1/object/portfolio/${fileName}`,
        {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': 'Bearer ' + SUPABASE_KEY,
            'Content-Type': `image/${match[1]}`,
          },
          body: buffer,
        }
      );

      if (!uploadRes.ok) {
        const err = await uploadRes.text();
        console.error('Storage upload error:', err);
        return res.status(500).json({ error: 'Upload failed. Create bucket "portfolio" in Supabase Storage.' });
      }

      // Public URL
      const imageUrl = `${SUPABASE_URL}/storage/v1/object/public/portfolio/${fileName}`;

      // Save to portfolio table
      const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/portfolio`, {
        method: 'POST',
        headers: { ...headers, 'Prefer': 'return=representation' },
        body: JSON.stringify({
          master_id: master.id,
          image_url: imageUrl,
          caption: caption || null,
        }),
      });

      if (!insertRes.ok) {
        const err = await insertRes.json();
        return res.status(500).json({ error: err.message || 'Insert failed' });
      }

      const created = await insertRes.json();
      return res.status(201).json(created[0]);
    }

    // --- DELETE: remove photo ---
    if (req.method === 'DELETE') {
      const photoId = req.query.id;
      if (!photoId) {
        return res.status(400).json({ error: 'Photo id required (?id=xxx)' });
      }

      // Get photo to find storage path
      const photoRes = await fetch(
        `${SUPABASE_URL}/rest/v1/portfolio?id=eq.${photoId}&master_id=eq.${master.id}&limit=1`,
        { headers }
      );
      const photos = await photoRes.json();
      if (!photos || photos.length === 0) {
        return res.status(404).json({ error: 'Photo not found' });
      }

      const photo = photos[0];

      // Delete from Storage
      const urlParts = photo.image_url.split('/portfolio/');
      if (urlParts.length === 2) {
        await fetch(
          `${SUPABASE_URL}/storage/v1/object/portfolio/${urlParts[1]}`,
          {
            method: 'DELETE',
            headers: {
              'apikey': SUPABASE_KEY,
              'Authorization': 'Bearer ' + SUPABASE_KEY,
            },
          }
        );
      }

      // Delete from DB
      await fetch(
        `${SUPABASE_URL}/rest/v1/portfolio?id=eq.${photoId}&master_id=eq.${master.id}`,
        { method: 'DELETE', headers }
      );

      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Admin portfolio error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

