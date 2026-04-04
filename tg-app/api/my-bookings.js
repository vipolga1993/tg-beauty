// Vercel Serverless Function: Client Bookings + Reviews
// GET  /api/my-bookings?tg_id=123          — записи клиента
// GET  /api/my-bookings?reviews=1&master_id=xxx — отзывы мастера
// POST /api/my-bookings                    — оставить отзыв

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY,
    'Content-Type': 'application/json',
  };

  // --- POST: create review ---
  if (req.method === 'POST') {
    try {
      const { bookingId, tgId, clientName, rating, reviewText } = req.body;

      if (!bookingId || !tgId || !rating) {
        return res.status(400).json({ error: 'bookingId, tgId, rating required' });
      }

      if (rating < 1 || rating > 5) {
        return res.status(400).json({ error: 'Rating must be 1-5' });
      }

      // Get booking to verify ownership and get master_id
      const bRes = await fetch(
        `${SUPABASE_URL}/rest/v1/bookings?id=eq.${bookingId}&client_tg_id=eq.${tgId}&limit=1`,
        { headers }
      );
      const bookings = await bRes.json();
      if (!bookings || bookings.length === 0) {
        return res.status(404).json({ error: 'Booking not found' });
      }

      const booking = bookings[0];

      // Check if review already exists
      const existRes = await fetch(
        `${SUPABASE_URL}/rest/v1/reviews?booking_id=eq.${bookingId}&limit=1`,
        { headers }
      );
      const existing = await existRes.json();
      if (existing && existing.length > 0) {
        return res.status(400).json({ error: 'Review already exists' });
      }

      // Create review
      await fetch(`${SUPABASE_URL}/rest/v1/reviews`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          master_id: booking.master_id,
          client_tg_id: tgId,
          client_name: clientName || 'Клиент',
          booking_id: bookingId,
          rating: rating,
          review_text: reviewText || '',
        }),
      });

      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error('Create review error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  // --- GET: reviews for master ---
  if (req.method === 'GET' && req.query.reviews) {
    try {
      const masterId = req.query.master_id;
      if (!masterId) {
        return res.status(400).json({ error: 'master_id required' });
      }

      const rRes = await fetch(
        `${SUPABASE_URL}/rest/v1/reviews?master_id=eq.${masterId}&order=created_at.desc&limit=50`,
        { headers }
      );
      const reviews = await rRes.json();
      return res.status(200).json(reviews || []);
    } catch (err) {
      console.error('Get reviews error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  // --- GET: client bookings ---
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const tgId = req.query.tg_id;
  if (!tgId) {
    return res.status(400).json({ error: 'tg_id required' });
  }

  try {
    // Get bookings for this client
    const bRes = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?client_tg_id=eq.${tgId}&order=date.desc,time.desc`,
      { headers }
    );
    const bookings = await bRes.json();

    if (!Array.isArray(bookings) || bookings.length === 0) {
      return res.status(200).json([]);
    }

    // Enrich with service info
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

    // Enrich with master info
    const masterIds = [...new Set(bookings.map(b => b.master_id))];
    const mQuery = masterIds.map(id => `id.eq.${id}`).join(',');
    const mRes = await fetch(
      `${SUPABASE_URL}/rest/v1/masters?or=(${mQuery})&select=id,name,address,phone`,
      { headers }
    );
    const mastersArr = await mRes.json();
    const masterMap = {};
    if (Array.isArray(mastersArr)) {
      mastersArr.forEach(m => { masterMap[m.id] = m; });
    }

    // Check which bookings already have reviews
    const bookingIds = bookings.map(b => b.id);
    const revQuery = bookingIds.map(id => `booking_id.eq.${id}`).join(',');
    const revRes = await fetch(
      `${SUPABASE_URL}/rest/v1/reviews?or=(${revQuery})&select=booking_id`,
      { headers }
    );
    const reviews = await revRes.json();
    const reviewedBookings = new Set();
    if (Array.isArray(reviews)) {
      reviews.forEach(r => { reviewedBookings.add(r.booking_id); });
    }

    bookings.forEach(b => {
      const svc = svcMap[b.service_id];
      if (svc) {
        b.service_name = svc.name;
        b.service_emoji = svc.emoji;
        b.service_price = svc.price;
        b.service_duration = svc.duration;
      }
      const m = masterMap[b.master_id];
      if (m) {
        b.master_name = m.name;
        b.master_address = m.address;
      }
      b.has_review = reviewedBookings.has(String(b.id)) || reviewedBookings.has(b.id);
    });

    return res.status(200).json(bookings);
  } catch (err) {
    console.error('My bookings error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
