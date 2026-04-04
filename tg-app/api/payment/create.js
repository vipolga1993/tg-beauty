// Vercel Serverless Function: Create Payment (YooKassa)
// POST /api/payment/create { period: "month" | "year" }

import { authenticateUser } from '../lib/validate-init-data.js';

const PRICES = {
  month: { amount: 800, label: 'PRO на месяц' },
  year: { amount: 8000, label: 'PRO на год' },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Init-Data');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const YUKASSA_SHOP_ID = process.env.YUKASSA_SHOP_ID;
  const YUKASSA_SECRET_KEY = process.env.YUKASSA_SECRET_KEY;

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

    const { period } = req.body;
    if (!period || !PRICES[period]) {
      return res.status(400).json({ error: 'period must be "month" or "year"' });
    }

    const price = PRICES[period];

    // If YooKassa is not configured, activate PRO directly (for testing)
    if (!YUKASSA_SHOP_ID || !YUKASSA_SECRET_KEY) {
      // TEST MODE: activate PRO without payment
      const days = period === 'year' ? 365 : 30;
      const expires = new Date();
      expires.setDate(expires.getDate() + days);

      await fetch(
        `${SUPABASE_URL}/rest/v1/masters?id=eq.${master.id}`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            plan: 'pro',
            plan_expires: expires.toISOString(),
          }),
        }
      );

      // Save payment record
      await fetch(`${SUPABASE_URL}/rest/v1/payments`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          master_id: master.id,
          amount: price.amount,
          period: period,
          status: 'completed',
          yukassa_id: 'test_' + Date.now(),
        }),
      });

      return res.status(200).json({
        ok: true,
        test_mode: true,
        plan: 'pro',
        expires: expires.toISOString(),
        message: 'PRO активирован (тестовый режим). Для реальной оплаты настройте YUKASSA_SHOP_ID и YUKASSA_SECRET_KEY.',
      });
    }

    // REAL MODE: create YooKassa payment
    const idempotenceKey = master.id + '_' + Date.now();

    const yukassaRes = await fetch('https://api.yookassa.ru/v3/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotence-Key': idempotenceKey,
        'Authorization': 'Basic ' + Buffer.from(YUKASSA_SHOP_ID + ':' + YUKASSA_SECRET_KEY).toString('base64'),
      },
      body: JSON.stringify({
        amount: {
          value: price.amount + '.00',
          currency: 'RUB',
        },
        confirmation: {
          type: 'redirect',
          return_url: 'https://t.me/tg_beautybot',
        },
        capture: true,
        description: price.label + ' — ' + master.name,
        metadata: {
          master_id: master.id,
          period: period,
        },
      }),
    });

    if (!yukassaRes.ok) {
      const err = await yukassaRes.text();
      console.error('YooKassa error:', err);
      return res.status(500).json({ error: 'Payment creation failed' });
    }

    const payment = await yukassaRes.json();

    // Save pending payment
    await fetch(`${SUPABASE_URL}/rest/v1/payments`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        master_id: master.id,
        amount: price.amount,
        period: period,
        status: 'pending',
        yukassa_id: payment.id,
      }),
    });

    return res.status(200).json({
      ok: true,
      confirmation_url: payment.confirmation.confirmation_url,
      payment_id: payment.id,
    });
  } catch (err) {
    console.error('Payment create error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

