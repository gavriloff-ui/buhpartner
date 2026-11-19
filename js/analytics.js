/**
 * Яндекс.Метрика: события целей (reachGoal) для счётчика 20397475.
 *
 * Имена событий (в них же создаются цели типа «Web-событие» в кабинете):
 *   lead_submit        — успешная отправка формы      (js/forms.js)
 *   lead_submit_error  — ошибка отправки формы        (js/forms.js)
 *   click_cta          — клик по CTA-кнопкам
 *   calculator_use     — расчёт стоимости в калькуляторе
 *   checklist_download — переход скачать чек-лист
 *   checklist_open     — открытие модалки чек-листа
 *   click_max          — клик по кнопке связи в MAX
 *
 * Работает на всех страницах: если элементов нет — хендлеры просто
 * не срабатывают. Зависимости: нет.
 */
(function () {
  'use strict';

  var COUNTER = 20397475;

  function goal(name, params) {
    try {
      if (typeof window.ym === 'function') {
        window.ym(COUNTER, 'reachGoal', name, params || {});
      }
    } catch (e) { /* noop */ }
  }

  function label(el) {
    return (el.getAttribute('aria-label') || el.textContent || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || typeof t.closest !== 'function') return;
    var page = location.pathname;

    // Открытие модалки чек-листа (лид-магнит)
    if (t.closest('[onclick*="openLeadModal"]')) {
      goal('checklist_open', { page: page });
    }

    // Кнопка связи в MAX (плавающая или в контенте)
    if (t.closest('.btn-whatsapp') || t.closest('a[href*="max.ru"]')) {
      goal('click_max', { page: page });
    }

    // Скачивание чек-листа (ссылка на checklist.html после отправки формы)
    if (t.closest('.btn-download')) {
      goal('checklist_download', { page: page });
    }

    // Калькулятор (это тоже .btn-primary, поэтому ветка до CTA)
    var calc = t.closest('#calc-btn');
    if (calc) {
      goal('calculator_use', {
        page: page,
        type: (document.getElementById('form-type') || {}).value || '',
        tax: (document.getElementById('form-tax') || {}).value || ''
      });
      return;
    }

    // Общие CTA-кнопки (не отправка форм — формы уже шлют lead_submit)
    var cta = t.closest('.btn-primary');
    if (cta) {
      goal('click_cta', { label: label(cta), page: page });
    }
  }, false);
})();
