// Vercel Serverless Function: Cancel Booking by Client
// POST /api/booking/cancel  { bookingId, tgId }
// Client can cancel only their own booking, at least 24h before

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const BOT_TOKEN = process.env.BOT_TOKEN;

  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY,
    'Content-Type': 'application/json',
  };

  const { bookingId, tgId } = req.body;
  if (!bookingId || !tgId) {
    return res.status(400).json({ error: 'bookingId and tgId required' });
  }

  try {
    // Get booking
    const bRes = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?id=eq.${bookingId}&client_tg_id=eq.${tgId}&limit=1`,
      { headers }
    );
    const bookings = await bRes.json();
    if (!bookings || bookings.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const booking = bookings[0];

    // Check status
    if (booking.status === 'cancelled') {
      return res.status(400).json({ error: 'Already cancelled' });
    }
    if (booking.status === 'completed') {
      return res.status(400).json({ error: 'Cannot cancel completed booking' });
    }

    // Check 24h rule
    const bookingDateTime = new Date(booking.date + 'T' + booking.time);
    const now = new Date();
    const hoursUntil = (bookingDateTime - now) / (1000 * 60 * 60);

    if (hoursUntil < 24) {
      return res.status(400).json({
        error: 'Too late to cancel',
        message: 'Отменить можно не позднее чем за 24 часа до записи.',
      });
    }

    // Cancel
    await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?id=eq.${bookingId}`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ status: 'cancelled' }),
      }
    );

    // Notify master
    if (BOT_TOKEN) {
      // Get master
      const mRes = await fetch(
        `${SUPABASE_URL}/rest/v1/masters?id=eq.${booking.master_id}&limit=1`,
        { headers }
      );
      const masters = await mRes.json();

      if (masters && masters[0]) {
        const master = masters[0];
        const text = [
          '❌ Клиент отменил запись',
          '',
          '👤 ' + booking.client_name + (booking.client_username ? ' (@' + booking.client_username + ')' : ''),
          '📅 ' + booking.date + ' в ' + booking.time.slice(0, 5),
        ].join('\n');

        await fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: master.telegram_id, text }),
        });
      }
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Cancel booking error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
