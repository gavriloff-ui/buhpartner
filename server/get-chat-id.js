/**
 * Одноразовый скрипт: узнаёт chat_id вашего диалога с ботом MAX.
 *
 * Как использовать:
 *   1. Создайте бота на платформе MAX для партнёров, возьмите токен.
 *   2. Напишите боту в MAX и нажмите «Начать» (или откройте ссылку
 *      https://max.ru/<имя_бота>?start=site )
 *   3. MAX_BOT_TOKEN=... node server/get-chat-id.js
 *
 * Скрипт делает long polling (GET /updates) и печатает chat_id из
 * события bot_started (или последнего message.created).
 * Зависимости: только Node.js 18+.
 */
'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

// загрузка server/.env (как в index.js)
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
}

const TOKEN = process.env.MAX_BOT_TOKEN || '';
if (!TOKEN) {
  console.error('Не задан MAX_BOT_TOKEN (переменная окружения или server/.env)');
  process.exit(1);
}

const CA = fs.readFileSync(path.join(__dirname, 'certs', 'russian_trusted_root_ca_pem.crt'));

function get(pathname) {
  if (!pathname.startsWith('/')) pathname = '/' + pathname;
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'platform-api2.max.ru',
        path: pathname,
        method: 'GET',
        headers: { Authorization: TOKEN },
        ca: CA,
        timeout: 100000, // long polling может ждать до 90 с
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(JSON.parse(data)); } catch (e) { resolve(data); }
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 300)}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end();
  });
}

(async () => {
  console.log('Ожидаю события от бота (long polling, до 90 сек)...');
  console.log('Если ещё не делали — напишите боту в MAX и нажмите «Начать».\n');

  let marker;
  for (let i = 0; i < 3; i++) {
    const q = `/updates?limit=10&timeout=90${marker != null ? `&marker=${marker}` : ''}`;
    const updates = await get(q);
    const list = (updates && updates.updates) || [];

    for (const u of list) {
      if (u.type === 'bot_started') {
        console.log('✅ Бот запущен!');
        console.log('   chat_id:', u.object.chat_id ?? u.object.chat?.chat_id ?? '(см. объект ниже)');
        console.log('   user_id:', u.object.user_id ?? u.object.user?.user_id ?? '');
        console.log('   Объект:', JSON.stringify(u.object, null, 2));
        console.log('\nЗапишите chat_id в server/.env как MAX_CHAT_ID=...');
        process.exit(0);
      }
      if (u.type === 'message.created') {
        const r = u.object.recipient || {};
        console.log('📨 Сообщение получено. chat_id:', r.chat_id, '| user_id:', r.user_id);
        console.log('   (этот chat_id тоже подходит — запишите в MAX_CHAT_ID)');
        process.exit(0);
      }
    }
    if (updates && updates.marker != null) marker = updates.marker;
    if (!list.length) console.log('  ...событий нет, продолжаю ждать');
  }
  console.log('Событий не получено. Убедитесь, что нажали «Начать» боту, и запустите снова.');
  process.exit(1);
})().catch((e) => {
  console.error('Ошибка:', e.message);
  process.exit(1);
});
