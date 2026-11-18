/**
 * Сервер-приёмник заявок для сайта buhpartner.ru
 * Принимает формы с сайта и пересылает заявки в мессенджер MAX
 * через официальный API ботов (platform-api2.max.ru).
 *
 * Зависимости: только Node.js 18+ (встроенные модули).
 *
 * Запуск:  node server/index.js
 * Настройка: переменные окружения или файл server/.env (см. .env.example)
 */
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

/* ─────────────── Конфигурация ─────────────── */

// Минимальный загрузчик .env без зависимостей
(function loadEnv() {
  const file = path.join(__dirname, '.env');
  if (!fs.existsSync(file)) return;
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !(m[1] in process.env)) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  });
})();

const CONFIG = {
  port: parseInt(process.env.PORT || '8080', 10),
  // Токен бота MAX (Чат-боты → Настройки → токен). Хранится ТОЛЬКО здесь, на сервере.
  maxToken: process.env.MAX_BOT_TOKEN || '',
  // ID чата/диалога, куда слать заявки. Получается скриптом get-chat-id.js
  maxChatId: process.env.MAX_CHAT_ID || '',
  // Разрешённые источники (CORS). Через запятую.
  allowedOrigins: (process.env.ALLOWED_ORIGINS || 'https://buhpartner.ru,https://www.buhpartner.ru')
    .split(',').map((s) => s.trim()).filter(Boolean),
  // Секрет для проверки запросов (заголовок X-Lead-Secret). Необязательно.
  sharedSecret: process.env.LEAD_SECRET || '',
  // Макс. заявок с одного IP за окно (анти-спам)
  rateLimit: parseInt(process.env.RATE_LIMIT || '10', 10),
  rateWindowMs: parseInt(process.env.RATE_WINDOW_MS || '600000', 10), // 10 минут
};

// Корневой сертификат Минцифры — без него API MAX недоступен (TLS)
const MAX_CA = fs.readFileSync(path.join(__dirname, 'certs', 'russian_trusted_root_ca_pem.crt'));

const MAX_API_HOST = 'platform-api2.max.ru';

/* ─────────────── Анти-спам: лимит по IP ─────────────── */

const hits = new Map(); // ip -> [timestamps]
function rateOk(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < CONFIG.rateWindowMs);
  if (arr.length >= CONFIG.rateLimit) {
    hits.set(ip, arr);
    return false;
  }
  arr.push(now);
  hits.set(ip, arr);
  return true;
}
// Очистка раз в час
setInterval(() => {
  const now = Date.now();
  for (const [ip, arr] of hits) {
    const alive = arr.filter((t) => now - t < CONFIG.rateWindowMs);
    if (alive.length) hits.set(ip, alive); else hits.delete(ip);
  }
}, 3600000).unref();

/* ─────────────── Отправка в MAX ─────────────── */

/**
 * Форматирует заявку в читаемое сообщение (лимит MAX — 4000 символов).
 */
function formatLead(d) {
  const esc = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, 1500);
  const lines = [
    '🆕 Новая заявка с сайта',
    `Форма: ${esc(d.source) || '—'}`,
    '',
    `Имя: ${esc(d.name) || '—'}`,
    `Телефон: ${esc(d.phone) || '—'}`,
    `E-mail: ${esc(d.email) || '—'}`,
  ];
  if (d.message) lines.push(`Комментарий: ${esc(d.message)}`);
  const utm = d.utm && typeof d.utm === 'object'
    ? Object.entries(d.utm).map(([k, v]) => `${k}=${v}`).join('&')
    : '';
  if (utm) lines.push(`UTM: ${utm.slice(0, 300)}`);
  if (d.page) lines.push(`Страница: ${esc(d.page)}`);
  if (d.referrer) lines.push(`Перешли с: ${esc(d.referrer).slice(0, 200)}`);
  lines.push(`Время: ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })} (МСК)`);
  return lines.join('\n').slice(0, 3900);
}

/**
 * POST https://platform-api2.max.ru/messages?chat_id=...
 * Резолвится при HTTP 2xx, иначе реджектится с описанием ошибки.
 */
function sendToMax(text) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ text, notify: true });
    const req = https.request(
      {
        hostname: MAX_API_HOST,
        path: `/messages?chat_id=${encodeURIComponent(CONFIG.maxChatId)}`,
        method: 'POST',
        headers: {
          Authorization: CONFIG.maxToken,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        ca: MAX_CA, // сертификат Минцифры
        timeout: 15000,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) return resolve(data);
          let msg = `HTTP ${res.statusCode}`;
          try { msg += ': ' + JSON.parse(data).message; } catch (e) { msg += ' ' + data.slice(0, 200); }
          reject(new Error(msg));
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.write(body);
    req.end();
  });
}

/* ─────────────── HTTP-сервер ─────────────── */

function corsHeaders(req) {
  const origin = req.headers.origin;
  const h = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Lead-Secret',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
  if (origin && CONFIG.allowedOrigins.includes(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
  }
  return h;
}

function json(res, status, obj, headers) {
  const body = JSON.stringify(obj);
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  }, headers || {}));
  res.end(body);
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const cors = corsHeaders(req);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
    json(res, 200, {
      ok: true,
      token: Boolean(CONFIG.maxToken),
      chat: Boolean(CONFIG.maxChatId),
    }, cors);
    return;
  }

  if (req.method === 'POST' && req.url === '/api/lead') {
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || '?';

    if (!CONFIG.maxToken || !CONFIG.maxChatId) {
      console.error('[lead] НЕ НАСТРОЕНО: задайте MAX_BOT_TOKEN и MAX_CHAT_ID в server/.env');
      json(res, 500, { error: 'Сервер заявок не настроен' }, cors);
      return;
    }
    if (CONFIG.sharedSecret && req.headers['x-lead-secret'] !== CONFIG.sharedSecret) {
      json(res, 403, { error: 'Запрещено' }, cors);
      return;
    }
    if (!rateOk(ip)) {
      json(res, 429, { error: 'Слишком много запросов, попробуйте позже' }, cors);
      return;
    }

    let data;
    try {
      data = JSON.parse(await readBody(req));
    } catch (e) {
      json(res, 400, { error: 'Некорректный запрос' }, cors);
      return;
    }

    // Серверная проверка honeypot (дубль клиентской)
    if (data._gotcha) {
      json(res, 200, { ok: true }, cors); // притворяемся успехом
      return;
    }
    // Валидация обязательных полей
    if (!data || typeof data !== 'object' || !String(data.name || '').trim()) {
      json(res, 422, { error: 'Укажите имя' }, cors);
      return;
    }
    if (!String(data.phone || '').trim() && !String(data.email || '').trim()) {
      json(res, 422, { error: 'Укажите телефон или e-mail' }, cors);
      return;
    }

    const text = formatLead(data);
    try {
      await sendToMax(text);
      console.log(`[lead] OK ${ip} :: ${String(data.source)} :: ${String(data.name)}`);
      json(res, 200, { ok: true }, cors);
    } catch (err) {
      console.error('[lead] Ошибка MAX:', err.message);
      json(res, 502, { error: 'Не удалось отправить заявку' }, cors);
    }
    return;
  }

  json(res, 404, { error: 'Not found' }, cors);
});

server.listen(CONFIG.port, () => {
  console.log(`БухПартнер — приём заявок → MAX`);
  console.log(`  http://localhost:${CONFIG.port}/api/lead`);
  console.log(`  Токен: ${CONFIG.maxToken ? 'задан ✓' : 'НЕ ЗАДАН ✗'} | chat_id: ${CONFIG.maxChatId || 'НЕ ЗАДАН ✗'}`);
  if (!CONFIG.maxToken || !CONFIG.maxChatId) {
    console.log('  Заполните server/.env (см. server/.env.example) и перезапустите.');
  }
});
