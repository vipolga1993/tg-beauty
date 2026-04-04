// Vercel Serverless Function: YooKassa Payment Webhook
// POST /api/payment/webhook — called by YooKassa when payment status changes

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const BOT_TOKEN = process.env.BOT_TOKEN;

  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY,
    'Content-Type': 'application/json',
  };

  try {
    const event = req.body;

    // YooKassa sends: { type: "notification", event: "payment.succeeded", object: { ... } }
    if (!event || event.event !== 'payment.succeeded') {
      return res.status(200).json({ ok: true, skipped: true });
    }

    const payment = event.object;
    const paymentId = payment.id;
    const metadata = payment.metadata || {};
    const masterId = metadata.master_id;
    const period = metadata.period;

    if (!masterId || !period) {
      console.error('Payment webhook: missing metadata', metadata);
      return res.status(200).json({ ok: true, error: 'missing metadata' });
    }

    // Calculate expiry
    const days = period === 'year' ? 365 : 30;
    const expires = new Date();
    expires.setDate(expires.getDate() + days);

    // Activate PRO
    await fetch(
      `${SUPABASE_URL}/rest/v1/masters?id=eq.${masterId}`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          plan: 'pro',
          plan_expires: expires.toISOString(),
        }),
      }
    );

    // Update payment status
    await fetch(
      `${SUPABASE_URL}/rest/v1/payments?yukassa_id=eq.${paymentId}`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ status: 'completed' }),
      }
    );

    // Notify master via Telegram
    if (BOT_TOKEN) {
      const masterRes = await fetch(
        `${SUPABASE_URL}/rest/v1/masters?id=eq.${masterId}&limit=1`,
        { headers }
      );
      const masters = await masterRes.json();

      if (masters && masters[0]) {
        const master = masters[0];
        const expiresStr = expires.toLocaleDateString('ru-RU', {
          day: 'numeric', month: 'long', year: 'numeric',
        });

        await fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: master.telegram_id,
            text: [
              'PRO активирован!',
              '',
              'Безлимит услуг и фото',
              'Напоминания клиентам',
              'Расширенная статистика',
              '',
              'Действует до ' + expiresStr,
            ].join('\n'),
          }),
        });
      }
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Payment webhook error:', err);
    return res.status(200).json({ ok: true, error: err.message });
  }
}
