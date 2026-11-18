/**
 * Отправка форм сайта на сервер-прокси → MAX.
 *
 * ═══════════════════════════════════════════════════════════
 * НАСТРОЙКА: вставьте URL вашего сервера-прокси после его
 * развёртывания (см. server/README.md), например:
 *
 *     var LEAD_ENDPOINT = 'https://functions.yandexcloud.net/xxxxxx';
 *
 * Пока здесь пустая строка — формы работают в ТЕСТОВОМ РЕЖИМЕ:
 * данные выводятся только в консоль браузера (F12), заявки
 * НЕ доставляются. Не забудьте вписать URL и закоммитить!
 * ═══════════════════════════════════════════════════════════
 */
(function () {
  'use strict';

  var LEAD_ENDPOINT = ''; // ← ВСТАВЬТЕ URL СЕРВЕРА ЗДЕСЬ
  var TIMEOUT_MS = 15000;
  var TEST_MODE = !LEAD_ENDPOINT;

  /* ---------- утилиты ---------- */

  function utmData() {
    var out = {};
    try {
      var p = new URLSearchParams(location.search);
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'yclid', 'from']
        .forEach(function (k) {
          var v = p.get(k);
          if (v) out[k] = v.slice(0, 200);
        });
    } catch (e) { /* noop */ }
    return out;
  }

  function collect(form, source) {
    var data = {};
    new FormData(form).forEach(function (v, k) {
      data[k] = String(v).slice(0, 3000);
    });
    data.source = source;
    data.page = location.pathname;
    data.referrer = document.referrer || '';
    data.utm = utmData();
    data.ts = new Date().toISOString();
    return data;
  }

  function toast(text, isError) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = text;
    el.style.background = isError ? '#b91c1c' : '';
    el.classList.add('show');
    clearTimeout(el._timer);
    el._timer = setTimeout(function () { el.classList.remove('show'); }, isError ? 7000 : 4000);
  }

  function inlineError(form, message) {
    var box = form.querySelector('.lead-form-error');
    if (!message) {
      if (box) box.remove();
      return;
    }
    if (!box) {
      box = document.createElement('p');
      box.className = 'lead-form-error';
      box.style.cssText = 'color:#dc2626;font-size:0.95rem;margin-top:12px;text-align:center;';
      form.appendChild(box);
    }
    box.textContent = message;
  }

  function trackGoal(goal, params) {
    try {
      if (typeof window.ym === 'function') window.ym(20397475, 'reachGoal', goal, params || {});
    } catch (e) { /* noop */ }
  }

  /* ---------- отправка ---------- */

  function postJSON(url, body) {
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, TIMEOUT_MS) : null;
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller ? controller.signal : undefined
    }).then(function (res) {
      if (timer) clearTimeout(timer);
      return res.json().catch(function () { return {}; }).then(function (json) {
        if (!res.ok) {
          var err = new Error(json.error || ('HTTP ' + res.status));
          err.status = res.status;
          throw err;
        }
        return json;
      });
    }, function (err) {
      if (timer) clearTimeout(timer);
      err.network = true;
      throw err;
    });
  }

  function send(payload) {
    // 1-я попытка, при сетевой ошибке или 502/504 — повтор через 1.5 с
    return postJSON(LEAD_ENDPOINT, payload).catch(function (err) {
      var retryable = err.network || err.status === 502 || err.status === 504;
      if (!retryable) throw err;
      return new Promise(function (resolve) { setTimeout(resolve, 1500); })
        .then(function () { return postJSON(LEAD_ENDPOINT, payload); });
    });
  }

  var PHONE_FALLBACK = 'Позвоните нам: +7 (950) 680-88-66';
  var sendQueue = Promise.resolve();

  function handleSubmit(e) {
    e.preventDefault();
    var form = e.currentTarget;
    if (form._sending) return;

    var source = form.getAttribute('data-source') || 'Форма';
    var successMode = form.getAttribute('data-success') || 'toast';
    var payload = collect(form, source);

    // Honeypot: бот заполнил скрытое поле — притворяемся успехом, но не отправляем
    if (payload._gotcha) {
      finishSuccess(form, successMode, true);
      return;
    }
    delete payload._gotcha;

    form._sending = true;
    var btn = form.querySelector('[type="submit"]');
    var btnText = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Отправка…'; }
    inlineError(form, '');

    var task = TEST_MODE
      ? Promise.resolve().then(function () {
          console.warn('[forms] ТЕСТОВЫЙ РЕЖИМ: LEAD_ENDPOINT не задан, заявка НЕ отправлена.');
          console.warn('[forms] Данные заявки:', payload);
          return {};
        })
      : send(payload);

    sendQueue = task
      .then(function () {
        finishSuccess(form, successMode, false);
        trackGoal('lead_submit', { form: source });
      })
      .catch(function (err) {
        console.error('[forms] Ошибка отправки:', err);
        var msg = 'Не удалось отправить заявку. ' + PHONE_FALLBACK;
        inlineError(form, msg);
        toast('Ошибка отправки. ' + PHONE_FALLBACK, true);
        trackGoal('lead_submit_error', { form: source });
      })
      .then(function () {
        form._sending = false;
        if (btn) { btn.disabled = false; btn.textContent = btnText; }
      });

    return sendQueue;
  }

  function finishSuccess(form, successMode, silent) {
    inlineError(form, '');
    if (successMode === 'lead') {
      // Модалка лид-магнита: прячем форму, показываем блок успеха
      form.style.display = 'none';
      var ok = document.getElementById('lead-success');
      if (ok) ok.classList.add('show');
    } else {
      toast('Заявка отправлена. Мы свяжемся с вами!', false);
      form.reset();
    }
    if (silent) console.warn('[forms] Honeypot сработал — заявка проигнорирована.');
  }

  /* ---------- инициализация ---------- */

  function init() {
    if (TEST_MODE) {
      console.warn('[forms] ⚠ LEAD_ENDPOINT не задан — формы в тестовом режиме (заявки не уходят). См. js/forms.js');
    }
    var forms = document.querySelectorAll('form[data-lead-form]');
    Array.prototype.forEach.call(forms, function (form) {
      if (form._leadBound) return;
      form._leadBound = true;
      // Honeypot-поле против спам-ботов
      var hp = document.createElement('input');
      hp.type = 'text';
      hp.name = '_gotcha';
      hp.tabIndex = -1;
      hp.autocomplete = 'off';
      hp.setAttribute('aria-hidden', 'true');
      hp.style.cssText = 'position:absolute;left:-9999px;top:auto;width:1px;height:1px;opacity:0;';
      form.appendChild(hp);
      form.addEventListener('submit', handleSubmit);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
