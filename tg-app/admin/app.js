/* ===========================================
   Admin Mini App — Логика
   =========================================== */

var API_BASE = '/api/admin';

// --- Telegram WebApp ---
var tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
}

// --- Состояние ---
var state = {
  profile: null,
  services: [],
  plan: 'free',
  limit: 3,
  editingService: null, // null = new, object = editing
  portfolio: [],
  portfolioLimit: 5,
  schedule: [],
  bookings: [],
  bookingsFilter: 'today',
};

// ===========================================
// API-хелпер с initData
// ===========================================

function getInitData() {
  return tg?.initData || '';
}

function apiRequest(path, options) {
  var opts = options || {};
  var headers = {
    'Content-Type': 'application/json',
    'X-Init-Data': getInitData(),
  };

  return fetch(API_BASE + path, {
    method: opts.method || 'GET',
    headers: headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  }).then(function(r) {
    if (!r.ok) {
      return r.json().then(function(err) { throw err; });
    }
    return r.json();
  });
}

// ===========================================
// Табы
// ===========================================

var tabBtns = document.querySelectorAll('.tabs__btn');
tabBtns.forEach(function(btn) {
  btn.addEventListener('click', function() {
    var tab = btn.dataset.tab;
    switchTab(tab);
  });
});

function switchTab(tab) {
  // Активная кнопка
  tabBtns.forEach(function(b) {
    b.classList.toggle('tabs__btn--active', b.dataset.tab === tab);
  });
  // Активный контент
  document.querySelectorAll('.tab-content').forEach(function(el) {
    el.classList.remove('tab-content--active');
  });
  document.getElementById('tab-' + tab).classList.add('tab-content--active');

  if (tg?.HapticFeedback) tg.HapticFeedback.selectionChanged();
}

// ===========================================
// Загрузка данных
// ===========================================

async function loadProfile() {
  try {
    var data = await apiRequest('/profile');
    state.profile = data;
    state.plan = data.plan || 'free';
    renderProfile();
    renderSubscription();
  } catch (err) {
    console.error('Load profile error:', err);
    showToast('Ошибка загрузки профиля');
  }
}

async function loadServices() {
  try {
    var data = await apiRequest('/services');
    state.services = data.services;
    state.plan = data.plan;
    state.limit = data.limit;
    renderServices();
  } catch (err) {
    console.error('Load services error:', err);
    var list = document.getElementById('services-list');
    var errMsg = err.error || err.message || JSON.stringify(err);
    var reason = err.reason || '';
    var hasInit = getInitData() ? 'initData: есть (' + getInitData().length + ' сим)' : 'initData: ПУСТО';
    list.innerHTML = '<p class="empty-hint" style="color:red">Ошибка: ' + errMsg + (reason ? '<br>reason: ' + reason : '') + '<br><small>' + hasInit + '</small></p>';
  }
}

// ===========================================
// Рендер: Профиль
// ===========================================

function renderProfile() {
  if (!state.profile) return;
  var p = state.profile;

  document.getElementById('inp-name').value = p.name || '';
  document.getElementById('inp-speciality').value = p.speciality || '';
  document.getElementById('inp-address').value = p.address || '';
  document.getElementById('inp-phone').value = p.phone || '';
  document.getElementById('inp-experience').value = p.experience || '';

  // Обложка профиля
  var coverImg = document.getElementById('cover-img');
  var cover = p.cover_url || p.avatar_url;
  if (cover) {
    coverImg.src = cover;
    coverImg.style.display = 'block';
  }

  // Ссылка для клиентов
  if (p.slug) {
    var link = 'https://t.me/tg_beautybot?start=m_' + p.slug;
    document.getElementById('inp-link').value = link;
    document.getElementById('share-link').style.display = '';
  }
}

// Смена обложки профиля
document.getElementById('btn-change-cover').addEventListener('click', function() {
  document.getElementById('cover-input').click();
});

document.getElementById('cover-input').addEventListener('change', async function() {
  var file = this.files[0];
  if (!file) return;
  this.value = '';

  if (file.size > 5 * 1024 * 1024) {
    showToast('Файл слишком большой (макс. 5 МБ)');
    return;
  }

  var reader = new FileReader();
  reader.onload = async function() {
    var base64 = reader.result;
    // Показываем превью сразу
    var coverImg = document.getElementById('cover-img');
    coverImg.src = base64;
    coverImg.style.display = 'block';

    try {
      var result = await apiRequest('/profile', {
        method: 'PUT',
        body: {
          name: document.getElementById('inp-name').value.trim() || (state.profile && state.profile.name) || '',
          cover_image: base64,
        },
      });
      state.profile = result;
      showToast('Фото обложки обновлено!');
      if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
    } catch (err) {
      showToast(err.message || 'Ошибка загрузки фото');
    }
  };
  reader.readAsDataURL(file);
});

// ===========================================
// Сохранить профиль
// ===========================================

document.getElementById('btn-save-profile').addEventListener('click', async function() {
  var btn = this;
  btn.disabled = true;
  btn.textContent = 'Сохраняю...';

  try {
    var body = {
      name: document.getElementById('inp-name').value.trim(),
      speciality: document.getElementById('inp-speciality').value.trim(),
      address: document.getElementById('inp-address').value.trim(),
      phone: document.getElementById('inp-phone').value.trim(),
      experience: document.getElementById('inp-experience').value.trim(),
    };

    if (!body.name) {
      showToast('Введите имя');
      return;
    }

    var updated = await apiRequest('/profile', { method: 'PUT', body: body });
    state.profile = updated;
    showToast('Профиль сохранён!');

    if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
  } catch (err) {
    console.error('Save profile error:', err);
    showToast(err.message || 'Ошибка сохранения');
    if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred('error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Сохранить';
  }
});

// Копировать ссылку
document.getElementById('btn-copy-link').addEventListener('click', function() {
  var input = document.getElementById('inp-link');
  input.select();

  if (navigator.clipboard) {
    navigator.clipboard.writeText(input.value);
  } else {
    document.execCommand('copy');
  }

  showToast('Ссылка скопирована!');
  if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
});

// ===========================================
// Рендер: Услуги
// ===========================================

function renderServices() {
  var list = document.getElementById('services-list');
  list.innerHTML = '';

  if (state.services.length === 0) {
    list.innerHTML = '<p class="empty-hint">Нет услуг. Нажмите «+ Добавить услугу»</p>';
  } else {
    state.services.forEach(function(svc) {
      var card = document.createElement('div');
      card.className = 'svc-card' + (svc.is_active ? '' : ' svc-card--inactive');

      var metaParts = [formatDuration(svc.duration)];
      if (!svc.is_active) metaParts.push('скрыта');

      var iconHtml = svc.image_url
        ? '<div class="svc-card__icon svc-card__icon--img"><img src="' + svc.image_url + '" alt=""></div>'
        : '<div class="svc-card__icon">' + (svc.emoji || '💅') + '</div>';

      card.innerHTML =
        iconHtml +
        '<div class="svc-card__info">' +
          '<div class="svc-card__name">' + escapeHtml(svc.name) +
            (!svc.is_active ? ' <span class="svc-card__badge">скрыта</span>' : '') +
          '</div>' +
          '<div class="svc-card__meta">' + metaParts[0] + '</div>' +
        '</div>' +
        '<div class="svc-card__price">' + formatPrice(svc.price) + '</div>';

      card.addEventListener('click', function() {
        openServiceModal(svc);
      });

      list.appendChild(card);
    });
  }

  // Лимит
  var limitBar = document.getElementById('limit-bar');
  if (state.limit) {
    var activeCount = state.services.filter(function(s) { return s.is_active; }).length;
    limitBar.style.display = '';
    document.getElementById('limit-text').textContent =
      'Услуг: ' + activeCount + ' из ' + state.limit + ' (бесплатный тариф)';
    limitBar.className = 'limit-bar' + (activeCount >= state.limit ? ' limit-bar--warning' : '');

    // Disable add button if at limit
    var addBtn = document.getElementById('btn-add-service');
    addBtn.disabled = activeCount >= state.limit;
  } else {
    limitBar.style.display = 'none';
  }
}

// ===========================================
// Модалка: Добавить / Редактировать услугу
// ===========================================

document.getElementById('btn-add-service').addEventListener('click', function() {
  openServiceModal(null);
});

var pendingSvcImage = null; // base64 image to upload

function openServiceModal(service) {
  state.editingService = service;
  pendingSvcImage = null;

  document.getElementById('modal-title').textContent = service ? 'Редактировать' : 'Новая услуга';
  document.getElementById('svc-name').value = service ? service.name : '';
  document.getElementById('svc-description').value = service ? (service.description || '') : '';
  document.getElementById('svc-price').value = service ? service.price : '';
  document.getElementById('svc-duration').value = service ? service.duration : '';
  document.getElementById('btn-delete-service').style.display = service ? '' : 'none';

  // Image preview
  var preview = document.getElementById('svc-image-preview');
  var previewImg = document.getElementById('svc-image-preview-img');
  var uploadBtn = document.getElementById('btn-upload-svc-photo');
  if (service && service.image_url) {
    previewImg.src = service.image_url;
    preview.style.display = '';
    uploadBtn.style.display = 'none';
  } else {
    previewImg.src = '';
    preview.style.display = 'none';
    uploadBtn.style.display = '';
  }

  // Emoji
  var selectedEmoji = service ? (service.emoji || '💅') : '💅';
  document.querySelectorAll('.emoji-option').forEach(function(el) {
    el.classList.toggle('emoji-option--selected', el.dataset.emoji === selectedEmoji);
  });

  showModal();
  if (tg?.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
}

// Service photo upload
document.getElementById('btn-upload-svc-photo').addEventListener('click', function() {
  document.getElementById('svc-photo-input').click();
});

document.getElementById('svc-photo-input').addEventListener('change', function() {
  var file = this.files[0];
  if (!file) return;
  this.value = '';

  if (file.size > 4 * 1024 * 1024) {
    showToast('Файл слишком большой (макс. 4 МБ)');
    return;
  }

  var reader = new FileReader();
  reader.onload = function() {
    pendingSvcImage = reader.result;
    document.getElementById('svc-image-preview-img').src = reader.result;
    document.getElementById('svc-image-preview').style.display = '';
    document.getElementById('btn-upload-svc-photo').style.display = 'none';
    // Deselect emoji
    document.querySelectorAll('.emoji-option').forEach(function(el) {
      el.classList.remove('emoji-option--selected');
    });
  };
  reader.readAsDataURL(file);
});

document.getElementById('svc-image-remove').addEventListener('click', function() {
  pendingSvcImage = null;
  document.getElementById('svc-image-preview-img').src = '';
  document.getElementById('svc-image-preview').style.display = 'none';
  document.getElementById('btn-upload-svc-photo').style.display = '';
  // Re-select default emoji
  var firstEmoji = document.querySelector('.emoji-option');
  if (firstEmoji) firstEmoji.classList.add('emoji-option--selected');
});

// Emoji picker
document.getElementById('emoji-picker').addEventListener('click', function(e) {
  var option = e.target.closest('.emoji-option');
  if (!option) return;

  document.querySelectorAll('.emoji-option').forEach(function(el) {
    el.classList.remove('emoji-option--selected');
  });
  option.classList.add('emoji-option--selected');

  if (tg?.HapticFeedback) tg.HapticFeedback.selectionChanged();
});

function getSelectedEmoji() {
  var selected = document.querySelector('.emoji-option--selected');
  return selected ? selected.dataset.emoji : '💅';
}

// Save service
document.getElementById('btn-save-service').addEventListener('click', async function() {
  var btn = this;
  btn.disabled = true;
  btn.textContent = 'Сохраняю...';

  try {
    var body = {
      name: document.getElementById('svc-name').value.trim(),
      description: document.getElementById('svc-description').value.trim(),
      price: document.getElementById('svc-price').value,
      duration: document.getElementById('svc-duration').value,
      emoji: getSelectedEmoji(),
    };

    // If new image uploaded, include it
    if (pendingSvcImage) {
      body.image = pendingSvcImage;
    }
    // If image was removed (had image before, now cleared)
    if (!pendingSvcImage && state.editingService && state.editingService.image_url
        && document.getElementById('svc-image-preview').style.display === 'none') {
      body.remove_image = true;
    }

    if (!body.name || !body.price || !body.duration) {
      var missing = [];
      if (!body.name) missing.push('название');
      if (!body.price) missing.push('цену');
      if (!body.duration) missing.push('длительность');
      showToast('Заполните: ' + missing.join(', '));
      return;
    }

    if (state.editingService) {
      // Update
      await apiRequest('/services?id=' + state.editingService.id, {
        method: 'PUT',
        body: body,
      });
      showToast('Услуга обновлена!');
    } else {
      // Create
      await apiRequest('/services', {
        method: 'POST',
        body: body,
      });
      showToast('Услуга добавлена!');
    }

    if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
    hideModal();
    await loadServices();
  } catch (err) {
    console.error('Save service error:', err);
    showToast(err.message || 'Ошибка сохранения');
    if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred('error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Сохранить';
  }
});

// Delete service
document.getElementById('btn-delete-service').addEventListener('click', async function() {
  if (!state.editingService) return;

  if (!confirm('Удалить услугу «' + state.editingService.name + '»?')) return;

  try {
    await apiRequest('/services?id=' + state.editingService.id, { method: 'DELETE' });
    showToast('Услуга удалена');

    if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
    hideModal();
    await loadServices();
  } catch (err) {
    console.error('Delete service error:', err);
    showToast(err.message || 'Ошибка удаления');
  }
});

// Close modal
document.getElementById('modal-close').addEventListener('click', hideModal);
document.getElementById('modal-overlay').addEventListener('click', function(e) {
  if (e.target === this) hideModal();
});

function showModal() {
  var overlay = document.getElementById('modal-overlay');
  overlay.style.display = 'flex';
  requestAnimationFrame(function() {
    requestAnimationFrame(function() {
      overlay.classList.add('modal-overlay--visible');
    });
  });
}

function hideModal() {
  var overlay = document.getElementById('modal-overlay');
  overlay.classList.remove('modal-overlay--visible');
  overlay.addEventListener('transitionend', function() {
    overlay.style.display = 'none';
  }, { once: true });
}

// ===========================================
// Портфолио
// ===========================================

var DAY_NAMES = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

async function loadPortfolio() {
  try {
    var data = await apiRequest('/portfolio');
    state.portfolio = data.portfolio;
    state.portfolioLimit = data.limit;
    renderPortfolio();
  } catch (err) {
    console.error('Load portfolio error:', err);
    document.getElementById('portfolio-grid').innerHTML =
      '<p class="empty-hint" style="color:red">Ошибка: ' + (err.error || err.message) + '</p>';
  }
}

function renderPortfolio() {
  var grid = document.getElementById('portfolio-grid');
  grid.innerHTML = '';

  if (!state.portfolio || state.portfolio.length === 0) {
    grid.innerHTML = '<p class="empty-hint">Нет фото. Нажмите «+ Загрузить фото»</p>';
  } else {
    state.portfolio.forEach(function(item) {
      var div = document.createElement('div');
      div.className = 'portfolio-item';
      div.innerHTML =
        '<img src="' + escapeHtml(item.image_url) + '" alt="">' +
        '<button class="portfolio-item__delete" data-id="' + item.id + '">&times;</button>';
      grid.appendChild(div);
    });

    // Delete handlers
    grid.querySelectorAll('.portfolio-item__delete').forEach(function(btn) {
      btn.addEventListener('click', async function(e) {
        e.stopPropagation();
        if (!confirm('Удалить это фото?')) return;
        try {
          await apiRequest('/portfolio?id=' + btn.dataset.id, { method: 'DELETE' });
          showToast('Фото удалено');
          await loadPortfolio();
        } catch (err) {
          showToast(err.message || 'Ошибка удаления');
        }
      });
    });
  }

  // Limit bar
  var limitBar = document.getElementById('portfolio-limit-bar');
  if (state.portfolioLimit) {
    var count = state.portfolio ? state.portfolio.length : 0;
    limitBar.style.display = '';
    document.getElementById('portfolio-limit-text').textContent =
      'Фото: ' + count + ' из ' + state.portfolioLimit + ' (бесплатный тариф)';
    limitBar.className = 'limit-bar' + (count >= state.portfolioLimit ? ' limit-bar--warning' : '');
    document.getElementById('btn-add-photo').disabled = count >= state.portfolioLimit;
  } else {
    limitBar.style.display = 'none';
  }
}

// Upload photo
document.getElementById('btn-add-photo').addEventListener('click', function() {
  document.getElementById('photo-input').click();
});

document.getElementById('photo-input').addEventListener('change', async function() {
  var file = this.files[0];
  if (!file) return;
  this.value = '';

  if (file.size > 4 * 1024 * 1024) {
    showToast('Файл слишком большой (макс. 4 МБ)');
    return;
  }

  showToast('Загружаю фото...');

  try {
    var base64 = await fileToBase64(file);
    await apiRequest('/portfolio', {
      method: 'POST',
      body: { image: base64 },
    });
    showToast('Фото загружено!');
    if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
    await loadPortfolio();
  } catch (err) {
    console.error('Upload error:', err);
    showToast(err.message || err.error || 'Ошибка загрузки');
    if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred('error');
  }
});

function fileToBase64(file) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onload = function() { resolve(reader.result); };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ===========================================
// Расписание
// ===========================================

async function loadSchedule() {
  try {
    var data = await apiRequest('/schedule');
    state.schedule = data;
    renderSchedule();
  } catch (err) {
    console.error('Load schedule error:', err);
    document.getElementById('schedule-list').innerHTML =
      '<p class="empty-hint" style="color:red">Ошибка: ' + (err.error || err.message) + '</p>';
  }
}

function renderSchedule() {
  var list = document.getElementById('schedule-list');
  list.innerHTML = '';

  if (!state.schedule || state.schedule.length === 0) {
    list.innerHTML = '<p class="empty-hint">Нет расписания</p>';
    return;
  }

  // Sort: Пн(1), Вт(2)...Сб(6), Вс(0)
  var sorted = state.schedule.slice().sort(function(a, b) {
    var orderA = a.day_of_week === 0 ? 7 : a.day_of_week;
    var orderB = b.day_of_week === 0 ? 7 : b.day_of_week;
    return orderA - orderB;
  });

  sorted.forEach(function(day) {
    var div = document.createElement('div');
    div.className = 'schedule-day' + (day.is_working ? '' : ' schedule-day--off');
    div.dataset.dow = day.day_of_week;

    var startTime = day.start_time ? day.start_time.slice(0, 5) : '10:00';
    var endTime = day.end_time ? day.end_time.slice(0, 5) : '18:00';

    div.innerHTML =
      '<span class="schedule-day__name">' + DAY_NAMES[day.day_of_week] + '</span>' +
      '<button class="schedule-day__toggle' + (day.is_working ? ' schedule-day__toggle--on' : '') +
      '" data-dow="' + day.day_of_week + '"></button>' +
      '<div class="schedule-day__times">' +
        '<input class="schedule-day__time-input" type="time" value="' + startTime + '" data-field="start">' +
        '<span class="schedule-day__sep">–</span>' +
        '<input class="schedule-day__time-input" type="time" value="' + endTime + '" data-field="end">' +
      '</div>';

    list.appendChild(div);
  });

  // Toggle handlers
  list.querySelectorAll('.schedule-day__toggle').forEach(function(btn) {
    btn.addEventListener('click', function() {
      btn.classList.toggle('schedule-day__toggle--on');
      var dayEl = btn.closest('.schedule-day');
      dayEl.classList.toggle('schedule-day--off');
      if (tg?.HapticFeedback) tg.HapticFeedback.selectionChanged();
    });
  });

  document.getElementById('btn-save-schedule').style.display = '';
}

// Save schedule
document.getElementById('btn-save-schedule').addEventListener('click', async function() {
  var btn = this;
  btn.disabled = true;
  btn.textContent = 'Сохраняю...';

  try {
    var days = [];
    document.querySelectorAll('.schedule-day').forEach(function(el) {
      var dow = parseInt(el.dataset.dow);
      var isOn = el.querySelector('.schedule-day__toggle').classList.contains('schedule-day__toggle--on');
      var startInput = el.querySelector('[data-field="start"]');
      var endInput = el.querySelector('[data-field="end"]');

      days.push({
        day_of_week: dow,
        is_working: isOn,
        start_time: startInput.value + ':00',
        end_time: endInput.value + ':00',
      });
    });

    await apiRequest('/schedule', { method: 'PUT', body: days });
    showToast('Расписание сохранено!');
    if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
  } catch (err) {
    console.error('Save schedule error:', err);
    showToast(err.message || 'Ошибка сохранения');
    if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred('error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Сохранить расписание';
  }
});

// ===========================================
// Записи (Дашборд)
// ===========================================

var bookingsFilterBtns = document.querySelectorAll('.bookings-filter__btn');
bookingsFilterBtns.forEach(function(btn) {
  btn.addEventListener('click', function() {
    state.bookingsFilter = btn.dataset.filter;
    bookingsFilterBtns.forEach(function(b) {
      b.classList.toggle('bookings-filter__btn--active', b.dataset.filter === state.bookingsFilter);
    });
    loadBookings();
    if (tg?.HapticFeedback) tg.HapticFeedback.selectionChanged();
  });
});

async function loadBookings() {
  try {
    var query = '/bookings';
    var today = new Date().toISOString().slice(0, 10);

    if (state.bookingsFilter === 'today') {
      query += '?date=' + today;
    } else if (state.bookingsFilter === 'upcoming') {
      query += '?upcoming=true';
    }

    state.bookings = await apiRequest(query);
    renderBookings();
  } catch (err) {
    console.error('Load bookings error:', err);
    document.getElementById('bookings-list').innerHTML =
      '<p class="empty-hint" style="color:red">Ошибка: ' + (err.error || err.message || '') + '</p>';
  }
}

function renderBookings() {
  var list = document.getElementById('bookings-list');
  list.innerHTML = '';

  if (!state.bookings || state.bookings.length === 0) {
    var msg = state.bookingsFilter === 'today' ? 'Нет записей на сегодня' : 'Нет записей';
    list.innerHTML = '<p class="empty-hint">' + msg + '</p>';
    return;
  }

  state.bookings.forEach(function(b) {
    var card = document.createElement('div');
    card.className = 'booking-card';

    var statusText = { pending: 'Ожидает', confirmed: 'Подтверждена', cancelled: 'Отменена', completed: 'Завершена' };
    var statusClass = 'booking-card__status--' + b.status;

    var timeStr = b.time ? b.time.slice(0, 5) : '';
    var endStr = b.end_time ? b.end_time.slice(0, 5) : '';
    var dateObj = b.date ? new Date(b.date + 'T00:00:00') : null;
    var dateStr = dateObj ? dateObj.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : b.date;

    card.innerHTML =
      '<div class="booking-card__header">' +
        '<div class="booking-card__emoji">' + (b.service_emoji || '💅') + '</div>' +
        '<div class="booking-card__info">' +
          '<div class="booking-card__service">' + escapeHtml(b.service_name || 'Услуга') + '</div>' +
          '<div class="booking-card__client">' + escapeHtml(b.client_name || 'Клиент') +
            (b.client_username ? ' @' + escapeHtml(b.client_username) : '') + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="booking-card__meta">' +
        '<span>' + dateStr + '</span>' +
        '<span>' + timeStr + (endStr ? ' – ' + endStr : '') + '</span>' +
        '<span>' + (b.service_price ? formatPrice(b.service_price) : '') + '</span>' +
      '</div>' +
      '<div style="margin-bottom:' + (b.status === 'pending' ? '10px' : '0') + '">' +
        '<span class="booking-card__status ' + statusClass + '">' + (statusText[b.status] || b.status) + '</span>' +
      '</div>' +
      (b.status === 'pending' ?
        '<div class="booking-card__actions">' +
          '<button class="btn-confirm" data-id="' + b.id + '">Подтвердить</button>' +
          '<button class="btn-cancel-booking" data-id="' + b.id + '">Отменить</button>' +
        '</div>' : '');

    list.appendChild(card);
  });

  // Action handlers
  list.querySelectorAll('.btn-confirm').forEach(function(btn) {
    btn.addEventListener('click', function() {
      updateBookingStatus(btn.dataset.id, 'confirmed');
    });
  });

  list.querySelectorAll('.btn-cancel-booking').forEach(function(btn) {
    btn.addEventListener('click', function() {
      if (!confirm('Отменить эту запись?')) return;
      updateBookingStatus(btn.dataset.id, 'cancelled');
    });
  });
}

async function updateBookingStatus(bookingId, action) {
  try {
    await apiRequest('/bookings', {
      method: 'PUT',
      body: { bookingId: bookingId, action: action },
    });
    showToast(action === 'confirmed' ? 'Запись подтверждена!' : 'Запись отменена');
    if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
    await loadBookings();
  } catch (err) {
    console.error('Update booking error:', err);
    showToast(err.message || 'Ошибка');
    if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred('error');
  }
}

// ===========================================
// Подписка PRO
// ===========================================

function renderSubscription() {
  if (!state.profile) return;

  var badge = document.getElementById('sub-badge');
  var freeInfo = document.getElementById('sub-free-info');
  var proInfo = document.getElementById('sub-pro-info');

  if (state.plan === 'pro') {
    badge.textContent = 'PRO';
    badge.className = 'subscription-badge subscription-badge--pro';
    freeInfo.style.display = 'none';
    proInfo.style.display = '';

    var expires = state.profile.plan_expires
      ? new Date(state.profile.plan_expires).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
      : '';
    document.getElementById('sub-expires').textContent = expires ? 'Действует до ' + expires : '';
  } else {
    badge.textContent = 'FREE';
    badge.className = 'subscription-badge';
    freeInfo.style.display = '';
    proInfo.style.display = 'none';
  }
}

// Subscribe buttons
document.getElementById('btn-sub-month').addEventListener('click', function() {
  subscribePro('month');
});

document.getElementById('btn-sub-year').addEventListener('click', function() {
  subscribePro('year');
});

async function subscribePro(period) {
  try {
    showToast('Создаю платёж...');

    var result = await fetch('/api/payment/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Init-Data': getInitData(),
      },
      body: JSON.stringify({ period: period }),
    }).then(function(r) { return r.json(); });

    if (result.test_mode) {
      // Test mode: PRO activated directly
      showToast('PRO активирован!');
      if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
      // Reload profile to get updated plan
      await loadProfile();
      await loadServices();
      await loadPortfolio();
      renderSubscription();
    } else if (result.confirmation_url) {
      // Real mode: redirect to YooKassa
      if (tg?.openLink) {
        tg.openLink(result.confirmation_url);
      } else {
        window.open(result.confirmation_url, '_blank');
      }
    } else {
      showToast(result.error || 'Ошибка создания платежа');
      if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred('error');
    }
  } catch (err) {
    console.error('Subscribe error:', err);
    showToast('Ошибка оплаты');
    if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred('error');
  }
}

// ===========================================
// Утилиты
// ===========================================

function formatPrice(price) {
  return Number(price).toLocaleString('ru-RU') + ' \u20BD';
}

function formatDuration(minutes) {
  if (minutes < 60) return minutes + ' мин';
  var h = Math.floor(minutes / 60);
  var m = minutes % 60;
  if (m === 0) return h + ' ч';
  return h + ' ч ' + m + ' мин';
}

function escapeHtml(str) {
  var div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showToast(text) {
  var toast = document.getElementById('toast');
  toast.textContent = text;
  toast.classList.add('toast--visible');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(function() {
    toast.classList.remove('toast--visible');
  }, 2500);
}

// ===========================================
// Старт
// ===========================================

loadProfile();
loadServices();
loadPortfolio();
loadSchedule();
loadBookings();
