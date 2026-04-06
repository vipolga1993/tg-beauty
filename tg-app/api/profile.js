// Vercel Serverless Function: публичная страница мастера
// GET /api/profile?slug=anna-ivanova
// Используется как ссылка в шапке Instagram

export default async function handler(req, res) {
  const slug = req.query.slug;

  if (!slug) {
    return res.status(400).send('<h1>Мастер не найден</h1>');
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY,
  };

  try {
    // Загружаем мастера
    const masterRes = await fetch(
      `${SUPABASE_URL}/rest/v1/masters?slug=eq.${encodeURIComponent(slug)}&limit=1&select=*`,
      { headers }
    );
    const masters = await masterRes.json();
    if (!masters || masters.length === 0) {
      return res.status(404).send(notFoundPage());
    }
    const master = masters[0];

    // Загружаем услуги
    const servicesRes = await fetch(
      `${SUPABASE_URL}/rest/v1/services?master_id=eq.${master.id}&is_active=eq.true&order=sort_order.asc&select=*`,
      { headers }
    );
    const services = servicesRes.ok ? await servicesRes.json() : [];

    // Загружаем портфолио (до 6 фото)
    const portfolioRes = await fetch(
      `${SUPABASE_URL}/rest/v1/portfolio?master_id=eq.${master.id}&order=sort_order.asc&limit=6&select=*`,
      { headers }
    );
    const portfolio = portfolioRes.ok ? await portfolioRes.json() : [];

    // Считаем средний рейтинг
    const reviewsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/reviews?master_id=eq.${master.id}&select=rating`,
      { headers }
    );
    const reviews = reviewsRes.ok ? await reviewsRes.json() : [];
    const avgRating = reviews.length
      ? (reviews.reduce((s, r) => s + (r.rating || 0), 0) / reviews.length).toFixed(1)
      : null;

    const botLink = `https://t.me/${process.env.BOT_USERNAME || 'tg_beautybot'}?start=${slug}`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).send(renderPage({ master, services, portfolio, avgRating, botLink }));

  } catch (err) {
    console.error('Profile page error:', err);
    return res.status(500).send('<h1>Ошибка сервера</h1>');
  }
}

function notFoundPage() {
  return `<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"><title>Мастер не найден</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>body{background:#080f0a;color:#fff;font-family:Inter,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;}
  .wrap{text-align:center;padding:2rem;}h1{color:#00e676;}a{color:#00e676;}</style></head>
  <body><div class="wrap"><h1>404</h1><p>Мастер не найден</p><a href="/">На главную</a></div></body></html>`;
}

function renderPage({ master, services, portfolio, avgRating, botLink }) {
  const name = master.name || 'Мастер';
  const specialty = master.specialty || '';
  const bio = master.bio || '';
  const address = master.address || '';
  const avatar = master.avatar_url || '';
  const reviewCount = 0; // можно добавить позже

  const starsHtml = avgRating
    ? `<div class="rating"><span class="star">★</span> ${avgRating}</div>`
    : '';

  const avatarHtml = avatar
    ? `<img class="avatar" src="${escHtml(avatar)}" alt="${escHtml(name)}">`
    : `<div class="avatar avatar--placeholder">${escHtml(name.charAt(0))}</div>`;

  const servicesHtml = services.length
    ? services.map(s => `
      <div class="service-card">
        <div class="service-left">
          <span class="service-emoji">${escHtml(s.emoji || '✨')}</span>
          <div>
            <div class="service-name">${escHtml(s.name)}</div>
            ${s.duration ? `<div class="service-duration">${s.duration} мин</div>` : ''}
          </div>
        </div>
        <div class="service-price">${s.price ? Number(s.price).toLocaleString('ru-RU') + ' ₽' : ''}</div>
      </div>`).join('')
    : '<p class="no-services">Услуги скоро появятся</p>';

  const portfolioHtml = portfolio.length
    ? `<section class="section">
        <h2 class="section-title">Портфолио</h2>
        <div class="portfolio-grid">
          ${portfolio.map(p => `<img class="portfolio-img" src="${escHtml(p.url)}" alt="работа">`).join('')}
        </div>
      </section>`
    : '';

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(name)} — запись онлайн</title>

  <!-- Open Graph для красивого превью в Instagram и других соцсетях -->
  <meta property="og:title" content="${escHtml(name)} — запись онлайн">
  <meta property="og:description" content="${escHtml(specialty || bio || 'Запишитесь онлайн через Telegram')}">
  ${avatar ? `<meta property="og:image" content="${escHtml(avatar)}">` : ''}
  <meta property="og:type" content="website">
  <meta name="twitter:card" content="summary_large_image">

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">

  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg: #080f0a;
      --surface: #0d1f12;
      --surface2: #122918;
      --accent: #00e676;
      --accent-dim: rgba(0,230,118,0.15);
      --text: #e8f5e9;
      --muted: #7cb393;
      --border: #1e4028;
      --radius: 16px;
    }

    body {
      background: var(--bg);
      color: var(--text);
      font-family: 'Inter', sans-serif;
      min-height: 100vh;
      padding-bottom: 120px;
    }

    /* Шапка */
    .hero {
      background: linear-gradient(180deg, #0d2e18 0%, var(--bg) 100%);
      padding: 48px 20px 32px;
      text-align: center;
    }

    .avatar {
      width: 96px;
      height: 96px;
      border-radius: 50%;
      object-fit: cover;
      border: 3px solid var(--accent);
      margin-bottom: 16px;
    }

    .avatar--placeholder {
      width: 96px;
      height: 96px;
      border-radius: 50%;
      background: var(--accent-dim);
      border: 3px solid var(--accent);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 2.5rem;
      font-weight: 700;
      color: var(--accent);
      margin-bottom: 16px;
    }

    .master-name {
      font-size: 1.6rem;
      font-weight: 700;
      color: #fff;
      margin-bottom: 6px;
    }

    .specialty {
      font-size: 1rem;
      color: var(--muted);
      margin-bottom: 10px;
    }

    .rating {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: var(--accent-dim);
      color: var(--accent);
      font-weight: 600;
      font-size: 0.9rem;
      padding: 4px 12px;
      border-radius: 20px;
      margin-bottom: 10px;
    }

    .star { color: #ffd600; }

    .address {
      font-size: 0.875rem;
      color: var(--muted);
      margin-top: 8px;
    }

    .address::before { content: '📍 '; }

    /* Основная кнопка */
    .book-btn {
      display: block;
      background: var(--accent);
      color: #051a0a;
      font-weight: 700;
      font-size: 1.05rem;
      text-decoration: none;
      text-align: center;
      padding: 16px 24px;
      border-radius: var(--radius);
      margin: 24px 20px 0;
      transition: opacity 0.2s;
    }

    .book-btn:active { opacity: 0.85; }

    /* Секции */
    .section {
      padding: 28px 20px 0;
    }

    .section-title {
      font-size: 1.1rem;
      font-weight: 700;
      color: #fff;
      margin-bottom: 14px;
    }

    /* Карточки услуг */
    .service-card {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 14px 16px;
      margin-bottom: 10px;
    }

    .service-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .service-emoji {
      font-size: 1.5rem;
    }

    .service-name {
      font-size: 0.95rem;
      font-weight: 600;
      color: #fff;
    }

    .service-duration {
      font-size: 0.8rem;
      color: var(--muted);
      margin-top: 2px;
    }

    .service-price {
      font-size: 0.95rem;
      font-weight: 700;
      color: var(--accent);
      white-space: nowrap;
    }

    .no-services {
      color: var(--muted);
      font-size: 0.9rem;
    }

    /* Портфолио */
    .portfolio-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 6px;
    }

    .portfolio-img {
      width: 100%;
      aspect-ratio: 1;
      object-fit: cover;
      border-radius: 10px;
    }

    /* Фиксированная кнопка внизу */
    .sticky-btn-wrap {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      padding: 12px 20px 24px;
      background: linear-gradient(0deg, var(--bg) 60%, transparent);
    }

    .sticky-btn {
      display: block;
      background: var(--accent);
      color: #051a0a;
      font-weight: 700;
      font-size: 1.05rem;
      text-decoration: none;
      text-align: center;
      padding: 16px;
      border-radius: var(--radius);
    }

    /* Бейдж MyMaster */
    .powered-by {
      text-align: center;
      font-size: 0.75rem;
      color: var(--muted);
      padding: 20px 0 0;
    }

    .powered-by a {
      color: var(--accent);
      text-decoration: none;
    }
  </style>
</head>
<body>

  <div class="hero">
    ${avatarHtml}
    <h1 class="master-name">${escHtml(name)}</h1>
    ${specialty ? `<p class="specialty">${escHtml(specialty)}</p>` : ''}
    ${starsHtml}
    ${address ? `<p class="address">${escHtml(address)}</p>` : ''}
    <a class="book-btn" href="${escHtml(botLink)}" target="_blank">
      ✈️ Записаться в Telegram
    </a>
  </div>

  ${bio ? `<section class="section"><p style="color:var(--muted);font-size:0.9rem;line-height:1.6;">${escHtml(bio)}</p></section>` : ''}

  <section class="section">
    <h2 class="section-title">Услуги</h2>
    ${servicesHtml}
  </section>

  ${portfolioHtml}

  <p class="powered-by">Онлайн-запись через <a href="/" target="_blank">MyMaster</a></p>

  <!-- Фиксированная кнопка внизу экрана -->
  <div class="sticky-btn-wrap">
    <a class="sticky-btn" href="${escHtml(botLink)}" target="_blank">
      ✈️ Записаться в Telegram
    </a>
  </div>

</body>
</html>`;
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
