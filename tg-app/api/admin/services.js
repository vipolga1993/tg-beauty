// Vercel Serverless Function: Admin Services CRUD
// GET    /api/admin/services         — список услуг мастера
// POST   /api/admin/services         — добавить услугу (FREE max 3)
// PUT    /api/admin/services?id=xxx  — редактировать услугу
// DELETE /api/admin/services?id=xxx  — удалить услугу

import { authenticateUser } from '../lib/validate-init-data.js';

const FREE_SERVICES_LIMIT = 3;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
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

    // --- GET: list services ---
    if (req.method === 'GET') {
      const svcRes = await fetch(
        `${SUPABASE_URL}/rest/v1/services?master_id=eq.${master.id}&order=sort_order,created_at`,
        { headers }
      );
      const services = await svcRes.json();
      return res.status(200).json({
        services,
        plan: master.plan,
        limit: master.plan === 'free' ? FREE_SERVICES_LIMIT : null,
      });
    }

    // --- POST: add service ---
    if (req.method === 'POST') {
      // Check FREE limit
      if (master.plan === 'free') {
        const countRes = await fetch(
          `${SUPABASE_URL}/rest/v1/services?master_id=eq.${master.id}&is_active=eq.true&select=id`,
          { headers }
        );
        const existing = await countRes.json();
        if (existing.length >= FREE_SERVICES_LIMIT) {
          return res.status(403).json({
            error: 'Free plan limit reached',
            message: `На бесплатном тарифе максимум ${FREE_SERVICES_LIMIT} услуг. Перейдите на PRO.`,
            limit: FREE_SERVICES_LIMIT,
          });
        }
      }

      const data = req.body;
      if (!data.name || !data.price || !data.duration) {
        return res.status(400).json({ error: 'name, price, duration required' });
      }

      // Upload image if provided
      let imageUrl = null;
      if (data.image) {
        imageUrl = await uploadServiceImage(SUPABASE_URL, SUPABASE_KEY, master.id, data.image);
      }

      const insertData = {
          master_id: master.id,
          name: data.name,
          description: data.description || null,
          price: parseInt(data.price),
          duration: parseInt(data.duration),
          emoji: data.emoji || '💅',
          sort_order: data.sort_order || 0,
          is_active: true,
      };
      if (imageUrl) insertData.image_url = imageUrl;

      const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/services`, {
        method: 'POST',
        headers: { ...headers, 'Prefer': 'return=representation' },
        body: JSON.stringify(insertData),
      });

      if (!insertRes.ok) {
        const err = await insertRes.json();
        return res.status(500).json({ error: err.message || 'Insert failed' });
      }

      const created = await insertRes.json();
      return res.status(201).json(created[0]);
    }

    // --- PUT: update service ---
    if (req.method === 'PUT') {
      const serviceId = req.query.id;
      if (!serviceId) {
        return res.status(400).json({ error: 'Service id required (?id=xxx)' });
      }

      // Verify service belongs to this master
      const checkRes = await fetch(
        `${SUPABASE_URL}/rest/v1/services?id=eq.${serviceId}&master_id=eq.${master.id}&limit=1`,
        { headers }
      );
      const existing = await checkRes.json();
      if (!existing || existing.length === 0) {
        return res.status(404).json({ error: 'Service not found' });
      }

      const data = req.body;
      const allowed = {};
      if (data.name !== undefined) allowed.name = data.name;
      if (data.description !== undefined) allowed.description = data.description;
      if (data.price !== undefined) allowed.price = parseInt(data.price);
      if (data.duration !== undefined) allowed.duration = parseInt(data.duration);
      if (data.emoji !== undefined) allowed.emoji = data.emoji;
      if (data.sort_order !== undefined) allowed.sort_order = parseInt(data.sort_order);
      if (data.is_active !== undefined) allowed.is_active = data.is_active;

      // Handle image upload
      if (data.image) {
        allowed.image_url = await uploadServiceImage(SUPABASE_URL, SUPABASE_KEY, master.id, data.image);
      } else if (data.remove_image) {
        allowed.image_url = null;
      }

      if (Object.keys(allowed).length === 0) {
        return res.status(400).json({ error: 'No fields to update' });
      }

      // If re-activating, check limit
      if (allowed.is_active === true && master.plan === 'free') {
        const countRes = await fetch(
          `${SUPABASE_URL}/rest/v1/services?master_id=eq.${master.id}&is_active=eq.true&select=id`,
          { headers }
        );
        const active = await countRes.json();
        // Exclude current service from count if it was inactive
        const currentActive = existing[0].is_active;
        const activeCount = currentActive ? active.length : active.length;
        if (!currentActive && active.length >= FREE_SERVICES_LIMIT) {
          return res.status(403).json({
            error: 'Free plan limit reached',
            message: `На бесплатном тарифе максимум ${FREE_SERVICES_LIMIT} активных услуг.`,
          });
        }
      }

      const updateRes = await fetch(
        `${SUPABASE_URL}/rest/v1/services?id=eq.${serviceId}&master_id=eq.${master.id}`,
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

    // --- DELETE: remove service ---
    if (req.method === 'DELETE') {
      const serviceId = req.query.id;
      if (!serviceId) {
        return res.status(400).json({ error: 'Service id required (?id=xxx)' });
      }

      const delRes = await fetch(
        `${SUPABASE_URL}/rest/v1/services?id=eq.${serviceId}&master_id=eq.${master.id}`,
        { method: 'DELETE', headers }
      );

      if (!delRes.ok) {
        return res.status(500).json({ error: 'Delete failed' });
      }

      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Admin services error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function uploadServiceImage(supabaseUrl, supabaseKey, masterId, base64Image) {
  const match = base64Image.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!match) throw new Error('Invalid image format');

  const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
  const buffer = Buffer.from(match[2], 'base64');
  const fileName = `${masterId}/svc_${Date.now()}.${ext}`;

  const uploadRes = await fetch(
    `${supabaseUrl}/storage/v1/object/services/${fileName}`,
    {
      method: 'POST',
      headers: {
        'apikey': supabaseKey,
        'Authorization': 'Bearer ' + supabaseKey,
        'Content-Type': `image/${match[1]}`,
      },
      body: buffer,
    }
  );

  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    console.error('Storage upload error:', err);
    throw new Error('Upload failed. Create bucket "services" in Supabase Storage.');
  }

  return `${supabaseUrl}/storage/v1/object/public/services/${fileName}`;
}

