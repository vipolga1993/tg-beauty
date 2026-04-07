/* ===========================================
   Telegram Mini App — Бьюти-мастер
   Основная логика приложения (мульти-тенант)
   =========================================== */

// --- Конфигурация Supabase ---
var SUPABASE_URL = 'https://pppxffhrgbzokjvnevme.supabase.co';
var SUPABASE_KEY = 'sb_publishable_KPfOnYwbG7uCYonnGDmCww_YX22JcNG';

// --- Telegram WebApp ---
var tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
}

// --- Состояние приложения ---
var state = {
  currentScreen: 'catalog',
  slug: null,           // slug мастера из URL или deep link
  master: null,         // профиль мастера из БД
  selectedService: null,
  selectedDate: null,
  selectedTime: null,
  services: [],
  portfolio: [],
  schedule: [],         // расписание мастера (7 дней)
  history: [],
};

// --- Фоллбэк-данные портфолио (градиенты, если нет фото) ---
var fallbackPortfolio = [
  { bg: 'linear-gradient(135deg, #fbc2eb, #fad0c4)', emoji: '💅' },
  { bg: 'linear-gradient(135deg, #c9b1ff, #e0c3fc)', emoji: '✨' },
  { bg: 'linear-gradient(135deg, #fbc2eb, #fda085)', emoji: '💖' },
  { bg: 'linear-gradient(135deg, #ff9a9e, #fecfef)', emoji: '🌸' },
  { bg: 'linear-gradient(135deg, #a1c4fd, #c2e9fb)', emoji: '💎' },
  { bg: 'linear-gradient(135deg, #89f7fe, #66d9a0)', emoji: '🦋' },
];

// ===========================================
// Supabase REST API хелпер
// ===========================================

function supabaseGet(path) {
  return fetch(SUPABASE_URL + '/rest/v1/' + path, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY }
  }).then(function(r) { return r.json(); });
}

function supabaseRpc(fnName, params) {
  return fetch(SUPABASE_URL + '/rest/v1/rpc/' + fnName, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  }).then(function(r) { return r.json(); });
}

// ===========================================
// Утилиты
// ===========================================

function formatPrice(price) {
  return price.toLocaleString('ru-RU') + ' ₽';
}

function formatDuration(minutes) {
  if (minutes < 60) return minutes + ' мин';
  var h = Math.floor(minutes / 60);
  var m = minutes % 60;
  if (m === 0) return h + ' ч';
  return h + ',' + (m < 10 ? '0' : '') + m.toString().replace(/0$/, '') + ' ч';
}

function formatDurationShort(minutes) {
  if (minutes < 60) return minutes + ' мин';
  var h = minutes / 60;
  if (h === Math.floor(h)) return Math.floor(h) + ' ч';
  return h.toFixed(1).replace('.', ',') + ' ч';
}

function getUserName() {
  var user = tg?.initDataUnsafe?.user;
  if (user) return user.first_name + (user.last_name ? ' ' + user.last_name : '');
  return 'Гость';
}

function haptic(type, style) {
  if (!tg?.HapticFeedback) return;
  if (type === 'impact') tg.HapticFeedback.impactOccurred(style || 'light');
  else if (type === 'notification') tg.HapticFeedback.notificationOccurred(style || 'success');
  else if (type === 'selection') tg.HapticFeedback.selectionChanged();
}

function getNextDays(count) {
  var days = [];
  var dayNames = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  var monthNames = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

  for (var i = 1; i <= count; i++) {
    var d = new Date();
    d.setDate(d.getDate() + i);
    days.push({
      date: d,
      dayName: dayNames[d.getDay()],
      dayNum: d.getDate(),
      month: monthNames[d.getMonth()],
      dayOfWeek: d.getDay(), // 0=Вс, 1=Пн...6=Сб
      dateStr: d.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' }),
      isoDate: d.toISOString().slice(0, 10), // "2026-03-15"
    });
  }
  return days;
}

function calcEndTime(startTime, durationMin) {
  var parts = startTime.split(':');
  var totalMin = parseInt(parts[0]) * 60 + parseInt(parts[1]) + durationMin;
  var h = Math.floor(totalMin / 60);
  var m = totalMin % 60;
  return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
}

// ===========================================
// Определение slug мастера
// ===========================================

function getSlug() {
  // 1. Из URL: ?slug=anna_ivanova_3102
  var urlParams = new URLSearchParams(window.location.search);
  var slug = urlParams.get('slug');
  if (slug) return slug;

  // 2. Из Telegram start_param (deep link)
  if (tg?.initDataUnsafe?.start_param) {
    return tg.initDataUnsafe.start_param;
  }

  return null;
}

// ===========================================
// Загрузка данных из Supabase
// ===========================================

async function loadMasterData() {
  state.slug = getSlug();

  if (!state.slug) {
    // Нет slug — показываем заглушку или дефолтные данные
    console.log('Нет slug мастера, загружаю демо-данные');
    await loadFallbackData();
    return;
  }

  try {
    // 1. Профиль мастера
    var masters = await supabaseGet('masters?slug=eq.' + state.slug + '&limit=1');
    if (!masters || masters.length === 0) {
      console.error('Мастер не найден:', state.slug);
      await loadFallbackData();
      return;
    }
    state.master = masters[0];

    // Проверка trial периода
    if (state.master.plan !== 'pro' && state.master.plan_expires) {
      var expiresDate = new Date(state.master.plan_expires);
      if (expiresDate < new Date()) {
        // Trial истёк — показываем сообщение
        document.getElementById('services-list').innerHTML =
          '<div style="text-align:center;padding:40px 20px;">' +
          '<div style="font-size:48px;margin-bottom:16px;">&#128274;</div>' +
          '<h3 style="margin-bottom:8px;">Мастер временно недоступен</h3>' +
          '<p style="color:var(--hint);font-size:14px;">Пробный период мастера истёк. Запись временно приостановлена.</p>' +
          '</div>';
        renderMasterProfile();
        return;
      }
    }

    // 2. Услуги мастера
    state.services = await supabaseGet('services?master_id=eq.' + state.master.id + '&is_active=eq.true&order=sort_order');

    // 3. Портфолио
    state.portfolio = await supabaseGet('portfolio?master_id=eq.' + state.master.id + '&order=sort_order');

    // 4. Расписание (для отображения выходных в календаре)
    state.schedule = await supabaseGet('schedule?master_id=eq.' + state.master.id);

    // Обновляем интерфейс
    renderMasterProfile();
    renderCatalog();
    renderPortfolio();
    loadPromotions();
    loadMasterReviews();
  } catch (error) {
    console.error('Ошибка загрузки данных:', error);
    await loadFallbackData();
  }
}

// Фоллбэк: загрузка из services.json (для локальной разработки)
async function loadFallbackData() {
  try {
    var response = await fetch('services.json');
    state.services = await response.json();
  } catch (e) {
    state.services = [];
  }
  state.portfolio = [];
  renderCatalog();
  renderPortfolio();
}

// ===========================================
// Рендер: Профиль мастера
// ===========================================

function renderMasterProfile() {
  if (!state.master) return;

  var m = state.master;

  // Имя
  var nameEl = document.getElementById('profile-name');
  if (nameEl) nameEl.textContent = m.name;

  // Аватар (инициалы)
  var avatarEl = document.getElementById('profile-avatar');
  if (avatarEl) {
    var initials = m.name.split(' ').map(function(w) { return w[0]; }).join('').slice(0, 2);
    avatarEl.textContent = initials;
  }

  // Теги специальности
  var tagsEl = document.getElementById('profile-tags');
  if (tagsEl && m.speciality) {
    tagsEl.innerHTML = '';
    m.speciality.split(',').forEach(function(tag) {
      var span = document.createElement('span');
      span.className = 'tag';
      span.textContent = tag.trim();
      tagsEl.appendChild(span);
    });
    if (m.experience) {
      var expSpan = document.createElement('span');
      expSpan.className = 'tag';
      expSpan.textContent = m.experience;
      tagsEl.appendChild(expSpan);
    }
  }

  // Адрес
  var addressEl = document.getElementById('profile-address');
  if (addressEl) {
    addressEl.textContent = m.address ? '📍 ' + m.address : '';
    addressEl.style.display = m.address ? '' : 'none';
  }

  // Кнопка «Позвонить»
  var callBtn = document.getElementById('btn-call');
  if (callBtn) {
    if (m.phone) {
      callBtn.href = 'tel:' + m.phone.replace(/[^\d+]/g, '');
      callBtn.style.display = '';
    } else {
      callBtn.style.display = 'none';
    }
  }

  // Статистика
  var statsEl = document.getElementById('profile-stats');
  if (statsEl) {
    statsEl.textContent = (m.total_bookings || 0) + ' записей';
  }

  // Обновляем карточку мастера на экране деталей
  var detailMasterName = document.querySelector('.detail__master-name');
  if (detailMasterName) detailMasterName.textContent = m.name;

  var detailMasterRole = document.querySelector('.detail__master-role');
  if (detailMasterRole) detailMasterRole.textContent = (m.speciality || '') + (m.experience ? ' · ' + m.experience : '');

  var detailMasterAvatar = document.querySelector('.detail__master-avatar');
  if (detailMasterAvatar) {
    var initials2 = m.name.split(' ').map(function(w) { return w[0]; }).join('').slice(0, 2);
    detailMasterAvatar.textContent = initials2;
  }
}

// ===========================================
// Рендер: Портфолио
// ===========================================

function renderPortfolio() {
  var grid = document.getElementById('portfolio-grid');
  if (!grid) return;
  grid.innerHTML = '';

  if (state.portfolio && state.portfolio.length > 0) {
    // Реальные фото из Supabase Storage (lazy loading)
    state.portfolio.forEach(function(item) {
      var div = document.createElement('div');
      div.className = 'portfolio__item';
      var img = document.createElement('img');
      img.src = item.image_url;
      img.loading = 'lazy';
      img.alt = item.caption || 'Фото работы';
      img.className = 'portfolio__img';
      div.appendChild(img);
      div.addEventListener('click', function() { haptic('impact', 'light'); });
      grid.appendChild(div);
    });
  } else {
    // Фоллбэк: градиенты
    fallbackPortfolio.forEach(function(item) {
      var div = document.createElement('div');
      div.className = 'portfolio__item';
      div.style.background = item.bg;
      div.textContent = item.emoji;
      div.addEventListener('click', function() { haptic('impact', 'light'); });
      grid.appendChild(div);
    });
  }
}

// ===========================================
// Рендер: Каталог услуг
// ===========================================

function renderCatalog() {
  var list = document.getElementById('services-list');
  if (!list) return;
  list.innerHTML = '';

  if (state.services.length === 0) {
    list.innerHTML = '<p style="text-align:center;color:var(--hint);padding:32px 0;">Мастер ещё не добавил услуги</p>';
    return;
  }

  state.services.forEach(function(service) {
    var card = document.createElement('div');
    card.className = 'service-card';

    var iconHtml = service.image_url
      ? '<div class="service-card__icon service-card__icon--img"><img src="' + service.image_url + '" alt=""></div>'
      : '<div class="service-card__icon">' + (service.emoji || '💅') + '</div>';

    card.innerHTML =
      iconHtml +
      '<div class="service-card__info">' +
        '<div class="service-card__name">' + service.name + '</div>' +
        '<div class="service-card__duration">' + formatDurationShort(service.duration) + '</div>' +
      '</div>' +
      '<div class="service-card__price">' + formatPrice(service.price) + '</div>';

    card.addEventListener('click', function() {
      haptic('impact', 'light');
      openDetail(service);
    });

    list.appendChild(card);
  });
}

// ===========================================
// Экран 2: Детали услуги
// ===========================================

function openDetail(service) {
  state.selectedService = service;

  document.getElementById('detail-name').textContent = service.name;

  // Карусель
  var carousel = document.getElementById('detail-carousel');
  var dotsContainer = document.getElementById('detail-dots');
  carousel.innerHTML = '';
  dotsContainer.innerHTML = '';

  var slides = [
    'linear-gradient(135deg, #fbc2eb, #fad0c4)',
    'linear-gradient(135deg, #c9b1ff, #e0c3fc)',
    'linear-gradient(135deg, #fbc2eb, #fda085)',
    'linear-gradient(135deg, #a1c4fd, #c2e9fb)',
    'linear-gradient(135deg, #89f7fe, #66d9a0)',
  ];

  slides.forEach(function(bg, i) {
    var item = document.createElement('div');
    item.className = 'detail__carousel-item';
    if (service.image_url && i === 0) {
      item.style.backgroundImage = 'url(' + service.image_url + ')';
      item.style.backgroundSize = 'cover';
      item.style.backgroundPosition = 'center';
    } else {
      item.style.background = bg;
      item.textContent = service.emoji || '💅';
    }
    carousel.appendChild(item);

    var dot = document.createElement('div');
    dot.className = 'detail__dot' + (i === 0 ? ' detail__dot--active' : '');
    dotsContainer.appendChild(dot);
  });

  carousel.addEventListener('scroll', function() {
    var scrollLeft = carousel.scrollLeft;
    var slideWidth = carousel.offsetWidth;
    var activeIndex = Math.round(scrollLeft / slideWidth);
    var dots = dotsContainer.querySelectorAll('.detail__dot');
    dots.forEach(function(dot, i) {
      dot.classList.toggle('detail__dot--active', i === activeIndex);
    });
  });

  carousel.scrollLeft = 0;

  document.getElementById('detail-price').textContent = formatPrice(service.price);
  document.getElementById('detail-duration').textContent = formatDurationShort(service.duration);
  var emojiEl = document.getElementById('detail-emoji');
  if (service.image_url) {
    emojiEl.innerHTML = '<img src="' + service.image_url + '" alt="">';
  } else {
    emojiEl.textContent = service.emoji || '💅';
  }
  document.getElementById('detail-description').textContent = service.description || '';

  navigateTo('detail');
}

// ===========================================
// Экран 3: Выбор даты и времени
// ===========================================

function openDatePicker() {
  haptic('impact', 'medium');
  state.selectedDate = null;
  state.selectedTime = null;
  promoState.applied = null;
  promoState.discount = 0;

  renderDatePicker();
  renderTimeSlots();

  document.getElementById('btn-confirm-booking').style.display = 'none';
  document.getElementById('booking-summary').style.display = 'none';
  document.getElementById('promo-input-wrap').style.display = 'none';

  navigateTo('date');
}

function isDayOff(dayOfWeek) {
  if (!state.schedule || state.schedule.length === 0) return false;
  var sch = state.schedule.find(function(s) { return s.day_of_week === dayOfWeek; });
  return !sch || !sch.is_working;
}

function renderDatePicker() {
  var container = document.getElementById('date-picker');
  container.innerHTML = '';
  var days = getNextDays(7);

  days.forEach(function(day) {
    var item = document.createElement('div');
    var dayOff = isDayOff(day.dayOfWeek);
    item.className = 'date-item' + (dayOff ? ' date-item--disabled' : '');

    item.innerHTML =
      '<span class="date-item__day-name">' + day.dayName + '</span>' +
      '<span class="date-item__day-num">' + day.dayNum + '</span>' +
      '<span class="date-item__month">' + day.month + '</span>';

    if (!dayOff) {
      item.addEventListener('click', function() {
        haptic('selection');
        selectDate(day, item);
      });
    }

    container.appendChild(item);
  });
}

async function selectDate(day, element) {
  state.selectedDate = day;
  state.selectedTime = null;

  document.querySelectorAll('.date-item').forEach(function(el) {
    el.classList.remove('date-item--selected');
  });
  element.classList.add('date-item--selected');

  document.getElementById('btn-confirm-booking').style.display = 'none';
  updateBookingSummary();

  // Загружаем свободные слоты из Supabase
  await renderTimeSlots();
}

async function renderTimeSlots() {
  var container = document.getElementById('time-slots');
  container.innerHTML = '';

  if (!state.selectedDate) {
    container.innerHTML = '<p class="time-slots__hint">Выберите дату, чтобы увидеть свободное время</p>';
    return;
  }

  // Загружаем слоты из БД (если есть slug)
  if (state.slug) {
    container.innerHTML = '<p class="time-slots__hint">Загружаю расписание...</p>';

    try {
      var slots = await supabaseRpc('get_available_slots', {
        master_slug: state.slug,
        target_date: state.selectedDate.isoDate,
        service_duration_min: state.selectedService ? state.selectedService.duration : 30,
      });

      container.innerHTML = '';

      if (!slots || slots.length === 0) {
        container.innerHTML = '<p class="time-slots__hint">Нет свободного времени на эту дату</p>';
        return;
      }

      slots.forEach(function(row) {
        var time = row.time_slot.slice(0, 5); // "10:00:00" → "10:00"
        var slot = document.createElement('div');
        slot.className = 'time-slot';
        slot.textContent = time;

        slot.addEventListener('click', function() {
          haptic('selection');
          selectTime(time, slot);
        });

        container.appendChild(slot);
      });
      return;
    } catch (err) {
      console.error('Ошибка загрузки слотов:', err);
    }
  }

  // Фоллбэк: статичные слоты
  var fallbackSlots = ['10:00', '10:30', '11:00', '11:30', '12:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30'];
  fallbackSlots.forEach(function(time) {
    var slot = document.createElement('div');
    slot.className = 'time-slot';
    slot.textContent = time;
    slot.addEventListener('click', function() {
      haptic('selection');
      selectTime(time, slot);
    });
    container.appendChild(slot);
  });
}

function selectTime(time, element) {
  state.selectedTime = time;

  document.querySelectorAll('.time-slot').forEach(function(el) {
    el.classList.remove('time-slot--selected');
  });
  element.classList.add('time-slot--selected');

  updateBookingSummary();
  document.getElementById('btn-confirm-booking').style.display = 'block';
  if (state.master) showPromoInput();
}

function updateBookingSummary() {
  var summary = document.getElementById('booking-summary');

  if (!state.selectedDate) {
    summary.style.display = 'none';
    return;
  }

  summary.style.display = 'flex';
  var summaryEmojiEl = document.getElementById('summary-emoji');
  if (state.selectedService.image_url) {
    summaryEmojiEl.innerHTML = '<img src="' + state.selectedService.image_url + '" alt="">';
  } else {
    summaryEmojiEl.textContent = state.selectedService.emoji || '💅';
  }
  document.getElementById('summary-name').textContent = state.selectedService.name;

  var metaText = state.selectedDate.dateStr;
  if (state.selectedTime) {
    metaText = state.selectedDate.dateStr + ' · ' + state.selectedTime;
  }
  document.getElementById('summary-meta').textContent = metaText;
}

// ===========================================
// Экран 4: Подтверждение записи
// ===========================================

function confirmBooking() {
  haptic('notification', 'success');

  var service = state.selectedService;
  var endTime = calcEndTime(state.selectedTime, service.duration);
  var masterName = state.master ? state.master.name : 'Мастер';
  var masterAddress = state.master ? state.master.address : '';

  // Цена со скидкой (определяем ДО использования)
  var finalPrice = service.price;
  if (promoState.applied && promoState.discount > 0) {
    finalPrice = Math.round(service.price - service.price * promoState.discount / 100);
  }

  var priceHtml = formatPrice(finalPrice);
  if (promoState.discount > 0) {
    priceHtml = '<s style="color:var(--hint)">' + formatPrice(service.price) + '</s> ' + formatPrice(finalPrice) + ' (−' + promoState.discount + '%)';
  }

  var card = document.getElementById('success-card');
  card.innerHTML =
    '<div class="success__card-line"><span>' + (service.emoji || '💅') + '</span> <strong>' + service.name + '</strong></div>' +
    '<div class="success__card-line"><span>📅</span> ' + state.selectedDate.dateStr + '</div>' +
    '<div class="success__card-line"><span>🕐</span> ' + state.selectedTime + ' – ' + endTime + '</div>' +
    '<div class="success__card-line"><span>💰</span> ' + priceHtml + '</div>' +
    '<div class="success__card-line"><span>👩‍🎨</span> ' + masterName + '</div>' +
    (masterAddress ? '<div class="success__card-line"><span>📍</span> <span style="color:var(--link)">' + masterAddress + '</span></div>' : '');

  // Данные для API
  var bookingData = {
    slug: state.slug,
    serviceId: service.id,
    serviceName: service.name,
    price: finalPrice,
    originalPrice: service.price,
    promoCode: promoState.applied ? promoState.applied.promo_code : null,
    discountPercent: promoState.discount || 0,
    duration: service.duration,
    date: state.selectedDate.isoDate,
    time: state.selectedTime,
    userName: getUserName(),
    userId: tg?.initDataUnsafe?.user?.id || null,
    userUsername: tg?.initDataUnsafe?.user?.username || null,
  };

  navigateTo('success');

  // Отправляем запись через API
  fetch('/api/book', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bookingData),
  })
  .then(function(res) { return res.json(); })
  .then(function(result) {
    if (!result.ok) {
      var msg = result.error === 'Trial expired'
        ? 'К сожалению, мастер приостановил запись. Обратитесь к мастеру напрямую.'
        : 'Не удалось создать запись. Попробуйте ещё раз.';
      document.getElementById('success-card').innerHTML +=
        '<div style="color:#ff5252;margin-top:12px;font-size:0.85rem">⚠️ ' + msg + '</div>';
    }
  })
  .catch(function() {
    document.getElementById('success-card').innerHTML +=
      '<div style="color:#ff5252;margin-top:12px;font-size:0.85rem">⚠️ Ошибка соединения. Проверьте интернет.</div>';
  });
}

// ===========================================
// Экран 5: Мои записи
// ===========================================

function openMyBookings() {
  haptic('impact', 'light');
  navigateTo('my-bookings');
  loadMyBookings();
}

async function loadMyBookings() {
  var list = document.getElementById('my-bookings-list');
  list.innerHTML = '<p class="time-slots__hint">Загрузка...</p>';

  var userId = tg?.initDataUnsafe?.user?.id;
  if (!userId) {
    list.innerHTML = '<p class="time-slots__hint">Войдите через Telegram, чтобы увидеть свои записи</p>';
    return;
  }

  try {
    var response = await fetch('/api/my-bookings?tg_id=' + userId);
    var bookings = await response.json();

    list.innerHTML = '';

    if (!bookings || bookings.length === 0) {
      list.innerHTML = '<p class="time-slots__hint">У вас пока нет записей</p>';
      return;
    }

    bookings.forEach(function(b) {
      var card = document.createElement('div');
      card.className = 'my-booking-card';

      var statusText = { pending: 'Ожидает', confirmed: 'Подтверждена', cancelled: 'Отменена', completed: 'Завершена' };
      var statusClass = 'my-booking-card__status--' + b.status;

      var timeStr = b.time ? b.time.slice(0, 5) : '';
      var endStr = b.end_time ? b.end_time.slice(0, 5) : '';
      var dateObj = b.date ? new Date(b.date + 'T00:00:00') : null;
      var dateStr = dateObj ? dateObj.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) : b.date;

      // Can cancel? (pending/confirmed, >24h before)
      var canCancel = false;
      if (b.status === 'pending' || b.status === 'confirmed') {
        var bookingDT = new Date(b.date + 'T' + b.time);
        var hoursUntil = (bookingDT - new Date()) / (1000 * 60 * 60);
        canCancel = hoursUntil >= 24;
      }

      card.innerHTML =
        '<div class="my-booking-card__header">' +
          '<div class="my-booking-card__emoji">' + (b.service_emoji || '💅') + '</div>' +
          '<div class="my-booking-card__info">' +
            '<div class="my-booking-card__service">' + (b.service_name || 'Услуга') + '</div>' +
            '<div class="my-booking-card__master">' + (b.master_name || 'Мастер') +
              (b.master_address ? ' · ' + b.master_address : '') + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="my-booking-card__meta">' +
          '<span>📅 ' + dateStr + '</span>' +
          '<span>🕐 ' + timeStr + (endStr ? ' – ' + endStr : '') + '</span>' +
          (b.service_price ? '<span>' + formatPrice(b.service_price) + '</span>' : '') +
        '</div>' +
        '<span class="my-booking-card__status ' + statusClass + '">' + (statusText[b.status] || b.status) + '</span>' +
        (canCancel ? '<button class="my-booking-card__cancel" data-id="' + b.id + '">Отменить запись</button>' : '') +
        (b.status === 'completed' && !b.has_review ? '<button class="my-booking-card__review" data-id="' + b.id + '" data-service="' + (b.service_name || 'Услуга') + '">⭐ Оставить отзыв</button>' : '') +
        (b.has_review ? '<div class="my-booking-card__reviewed">✓ Отзыв оставлен</div>' : '') +
        (b.status === 'completed' || b.status === 'cancelled' ? '<button class="my-booking-card__rebook" data-service-id="' + b.service_id + '">🔄 Записаться снова</button>' : '');

      list.appendChild(card);
    });

    // Rebook handlers
    list.querySelectorAll('.my-booking-card__rebook').forEach(function(btn) {
      btn.addEventListener('click', function() {
        haptic('impact', 'light');
        rebookService(btn.dataset.serviceId);
      });
    });

    // Review handlers
    list.querySelectorAll('.my-booking-card__review').forEach(function(btn) {
      btn.addEventListener('click', function() {
        haptic('impact', 'light');
        openReviewModal(btn.dataset.id, btn.dataset.service);
      });
    });

    // Cancel handlers
    list.querySelectorAll('.my-booking-card__cancel').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        if (!confirm('Отменить эту запись?')) return;
        btn.disabled = true;
        btn.textContent = 'Отмена...';

        try {
          var res = await fetch('/api/booking/cancel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bookingId: btn.dataset.id, tgId: userId }),
          });
          var result = await res.json();

          if (res.ok) {
            haptic('notification', 'success');
            loadMyBookings(); // refresh
          } else {
            alert(result.message || result.error || 'Ошибка отмены');
            btn.disabled = false;
            btn.textContent = 'Отменить запись';
          }
        } catch (err) {
          alert('Ошибка сети');
          btn.disabled = false;
          btn.textContent = 'Отменить запись';
        }
      });
    });

  } catch (err) {
    console.error('Load my bookings error:', err);
    list.innerHTML = '<p class="time-slots__hint">Ошибка загрузки</p>';
  }
}

// ===========================================
// Отзывы: форма + отправка
// ===========================================

var reviewState = { bookingId: null, rating: 0 };

function openReviewModal(bookingId, serviceName) {
  reviewState.bookingId = bookingId;
  reviewState.rating = 0;

  document.getElementById('review-service-name').textContent = serviceName;
  document.getElementById('review-text').value = '';
  updateReviewStars(0);

  var overlay = document.getElementById('review-overlay');
  overlay.style.display = 'flex';
  requestAnimationFrame(function() {
    requestAnimationFrame(function() {
      overlay.classList.add('offer-overlay--visible');
    });
  });
}

function closeReviewModal() {
  var overlay = document.getElementById('review-overlay');
  overlay.classList.remove('offer-overlay--visible');
  overlay.addEventListener('transitionend', function() {
    overlay.style.display = 'none';
  }, { once: true });
}

function updateReviewStars(rating) {
  reviewState.rating = rating;
  var stars = document.querySelectorAll('#review-stars .review-star');
  stars.forEach(function(star) {
    var val = parseInt(star.dataset.rating);
    star.classList.toggle('review-star--active', val <= rating);
  });
}

// Обработчики кликов на звёзды
document.addEventListener('DOMContentLoaded', function() {
  var starsContainer = document.getElementById('review-stars');
  if (starsContainer) {
    starsContainer.addEventListener('click', function(e) {
      var star = e.target.closest('.review-star');
      if (star) {
        haptic('selection');
        updateReviewStars(parseInt(star.dataset.rating));
      }
    });
  }
});

async function submitReview() {
  if (reviewState.rating === 0) {
    alert('Выберите оценку');
    return;
  }

  var btn = document.getElementById('review-submit-btn');
  btn.disabled = true;
  btn.textContent = 'Отправка...';

  var userId = tg?.initDataUnsafe?.user?.id;
  var userName = getUserName();

  try {
    var res = await fetch('/api/my-bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bookingId: reviewState.bookingId,
        tgId: userId,
        clientName: userName,
        rating: reviewState.rating,
        reviewText: document.getElementById('review-text').value.trim(),
      }),
    });
    var result = await res.json();

    if (res.ok && result.ok) {
      haptic('notification', 'success');
      closeReviewModal();
      loadMyBookings(); // обновить список
    } else {
      alert(result.error || 'Ошибка отправки отзыва');
    }
  } catch (err) {
    alert('Ошибка сети');
  }

  btn.disabled = false;
  btn.textContent = 'Отправить';
}

// ===========================================
// Отзывы: отображение на странице мастера
// ===========================================

async function loadMasterReviews() {
  if (!state.master) return;

  try {
    var reviews = await fetch('/api/my-bookings?reviews=1&master_id=' + state.master.id)
      .then(function(r) { return r.json(); });

    var section = document.getElementById('reviews-section');
    var list = document.getElementById('reviews-list');
    var title = document.getElementById('reviews-title');

    if (!reviews || reviews.length === 0) {
      section.style.display = 'none';
      return;
    }

    // Средний рейтинг
    var sum = 0;
    reviews.forEach(function(r) { sum += r.rating; });
    var avg = (sum / reviews.length).toFixed(1);

    title.textContent = 'Отзывы · ' + avg + ' ★ (' + reviews.length + ')';

    // Обновляем статистику в профиле
    var statsEl = document.getElementById('profile-stats');
    if (statsEl) {
      statsEl.textContent = avg + ' ★ · ' + reviews.length + ' отзыв' + pluralReview(reviews.length) + ' · ' + (state.master.total_bookings || 0) + ' записей';
    }

    list.innerHTML = '';
    reviews.forEach(function(r) {
      var card = document.createElement('div');
      card.className = 'review-card';

      var starsHtml = '';
      for (var i = 1; i <= 5; i++) {
        starsHtml += '<span class="review-card__star' + (i <= r.rating ? ' review-card__star--filled' : '') + '">★</span>';
      }

      var dateStr = '';
      if (r.created_at) {
        var d = new Date(r.created_at);
        dateStr = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
      }

      card.innerHTML =
        '<div class="review-card__header">' +
          '<div class="review-card__name">' + (r.client_name || 'Клиент') + '</div>' +
          '<div class="review-card__date">' + dateStr + '</div>' +
        '</div>' +
        '<div class="review-card__stars">' + starsHtml + '</div>' +
        (r.review_text ? '<div class="review-card__text">' + escapeHtml(r.review_text) + '</div>' : '');

      list.appendChild(card);
    });

    section.style.display = 'block';
  } catch (err) {
    console.error('Load reviews error:', err);
  }
}

function pluralReview(n) {
  var mod10 = n % 10;
  var mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return '';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'а';
  return 'ов';
}

function escapeHtml(text) {
  var div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ===========================================
// Акции и промокоды
// ===========================================

var promoState = { applied: null, discount: 0 };

async function loadPromotions() {
  if (!state.master) return;

  try {
    var promos = await supabaseGet(
      'promotions?master_id=eq.' + state.master.id +
      '&is_active=eq.true&valid_until=gte.' + new Date().toISOString().slice(0, 10) +
      '&order=created_at.desc'
    );

    var section = document.getElementById('promos-section');
    var list = document.getElementById('promos-list');

    if (!promos || promos.length === 0) {
      section.style.display = 'none';
      return;
    }

    list.innerHTML = '';
    promos.forEach(function(p) {
      var card = document.createElement('div');
      card.className = 'promo-card';

      var discountText = p.discount_percent ? ('-' + p.discount_percent + '%') : '';
      var validDate = '';
      if (p.valid_until) {
        var d = new Date(p.valid_until + 'T00:00:00');
        validDate = 'до ' + d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
      }

      card.innerHTML =
        '<div class="promo-card__badge">' + discountText + '</div>' +
        '<div class="promo-card__emoji">' + (p.emoji || '🎁') + '</div>' +
        '<div class="promo-card__title">' + (p.title || 'Акция') + '</div>' +
        (p.description ? '<div class="promo-card__desc">' + p.description + '</div>' : '') +
        (p.promo_code ? '<div class="promo-card__code">Код: <strong>' + p.promo_code + '</strong></div>' : '') +
        (validDate ? '<div class="promo-card__valid">' + validDate + '</div>' : '');

      list.appendChild(card);
    });

    section.style.display = 'block';
  } catch (err) {
    console.error('Load promotions error:', err);
  }
}

function showPromoInput() {
  var wrap = document.getElementById('promo-input-wrap');
  if (wrap) {
    wrap.style.display = 'block';
    promoState.applied = null;
    promoState.discount = 0;
    document.getElementById('promo-input').value = '';
    document.getElementById('promo-result').textContent = '';
    document.getElementById('promo-result').className = 'promo-result';
  }
}

async function applyPromoCode() {
  var input = document.getElementById('promo-input');
  var result = document.getElementById('promo-result');
  var code = input.value.trim().toUpperCase();

  if (!code) return;

  var btn = document.getElementById('promo-apply-btn');
  btn.disabled = true;
  btn.textContent = '...';

  try {
    var promos = await supabaseGet(
      'promotions?master_id=eq.' + state.master.id +
      '&promo_code=eq.' + code +
      '&is_active=eq.true&valid_until=gte.' + new Date().toISOString().slice(0, 10) +
      '&limit=1'
    );

    if (promos && promos.length > 0) {
      var promo = promos[0];
      promoState.applied = promo;
      promoState.discount = promo.discount_percent || 0;

      var discountAmount = Math.round(state.selectedService.price * promoState.discount / 100);
      var newPrice = state.selectedService.price - discountAmount;

      result.textContent = '✓ Скидка ' + promoState.discount + '% применена! Итого: ' + formatPrice(newPrice);
      result.className = 'promo-result promo-result--success';
      haptic('notification', 'success');
    } else {
      promoState.applied = null;
      promoState.discount = 0;
      result.textContent = '✕ Промокод не найден или истёк';
      result.className = 'promo-result promo-result--error';
      haptic('notification', 'error');
    }
  } catch (err) {
    result.textContent = 'Ошибка проверки';
    result.className = 'promo-result promo-result--error';
  }

  btn.disabled = false;
  btn.textContent = 'Применить';
}

// ===========================================
// Повторная запись
// ===========================================

function rebookService(serviceId) {
  // Ищем услугу в загруженных данных
  var service = state.services.find(function(s) { return String(s.id) === String(serviceId); });

  if (!service) {
    alert('Эта услуга больше недоступна');
    return;
  }

  state.selectedService = service;
  state.selectedDate = null;
  state.selectedTime = null;
  state.history = ['catalog', 'my-bookings'];

  renderDatePicker();
  renderTimeSlots();
  document.getElementById('btn-confirm-booking').style.display = 'none';
  document.getElementById('booking-summary').style.display = 'none';

  navigateTo('date');
}

// --- Вернуться в каталог ---
function goToCatalog() {
  haptic('impact', 'light');
  state.history = [];
  state.selectedService = null;
  state.selectedDate = null;
  state.selectedTime = null;
  navigateTo('catalog');
}

// ===========================================
// Навигация между экранами
// ===========================================

function navigateTo(screenName, isBack) {
  var currentEl = document.getElementById('screen-' + state.currentScreen);
  var nextEl = document.getElementById('screen-' + screenName);
  if (!currentEl || !nextEl) return;

  currentEl.classList.remove('screen--active');
  currentEl.style.display = 'none';

  if (!isBack && state.currentScreen !== screenName) {
    state.history.push(state.currentScreen);
  }

  nextEl.classList.add(isBack ? 'screen--entering-back' : 'screen--entering');
  nextEl.style.display = 'block';

  requestAnimationFrame(function() {
    requestAnimationFrame(function() {
      nextEl.classList.remove('screen--entering', 'screen--entering-back');
      nextEl.classList.add('screen--active');
    });
  });

  state.currentScreen = screenName;
  window.scrollTo(0, 0);

  if (tg?.BackButton) {
    if (state.history.length > 0 && screenName !== 'success') {
      tg.BackButton.show();
    } else {
      tg.BackButton.hide();
    }
  }
}

function goBack() {
  if (state.history.length === 0) return;
  haptic('impact', 'light');
  var prev = state.history.pop();
  navigateTo(prev, true);
}

if (tg?.BackButton) {
  tg.BackButton.onClick(goBack);
}

// ===========================================
// Модалка-оффер (показываем один раз)
// ===========================================

function showOfferIfNeeded() {
  if (localStorage.getItem('offer_shown_v2')) return;

  var overlay = document.getElementById('offer-overlay');
  overlay.style.display = 'flex';

  requestAnimationFrame(function() {
    requestAnimationFrame(function() {
      overlay.classList.add('offer-overlay--visible');
    });
  });

  localStorage.setItem('offer_shown_v2', '1');
}

function closeOffer() {
  var overlay = document.getElementById('offer-overlay');
  overlay.classList.remove('offer-overlay--visible');
  overlay.addEventListener('transitionend', function() {
    overlay.style.display = 'none';
  }, { once: true });
}

// ===========================================
// Онбординг (показываем один раз)
// ===========================================

function showWelcomeIfNeeded() {
  if (localStorage.getItem('welcome_done')) {
    document.getElementById('screen-catalog').classList.add('screen--active');
    state.currentScreen = 'catalog';
    return;
  }

  var firstName = tg?.initDataUnsafe?.user?.first_name;
  if (firstName) {
    document.getElementById('welcome-title').textContent = firstName + ', добро пожаловать!';
  }

  document.getElementById('screen-welcome').classList.add('screen--active');
  state.currentScreen = 'welcome';
}

function startFromWelcome() {
  haptic('impact', 'medium');
  localStorage.setItem('welcome_done', '1');
  navigateTo('catalog');
}

// ===========================================
// Поделиться с другом
// ===========================================

function shareWithFriend() {
  haptic('impact', 'light');
  var masterName = state.master ? state.master.name : 'мастеру';
  var text = 'Записываюсь к ' + masterName + ' прямо в Telegram! Попробуй тоже:';
  var url = state.slug
    ? 'https://t.me/tg_beautybot?start=m_' + state.slug
    : 'https://t.me/tg_beautybot';

  if (tg?.openTelegramLink) {
    tg.openTelegramLink('https://t.me/share/url?url=' + encodeURIComponent(url) + '&text=' + encodeURIComponent(text));
  } else {
    window.open('https://t.me/share/url?url=' + encodeURIComponent(url) + '&text=' + encodeURIComponent(text), '_blank');
  }
}

// --- Старт ---
loadMasterData();
showWelcomeIfNeeded();
showOfferIfNeeded();
