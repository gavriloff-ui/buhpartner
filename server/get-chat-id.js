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
  console.log('Ожидаю события от бота (long polling, до 90 сек за ожидание)...');
  console.log('⚠ Нажмите «Начать» боту ИМЕННО ВО ВРЕМЯ ожидания (или впервые — после старта скрипта).');
  console.log('   Скрипт проработает до ~9 минут.\n');

  let marker;
  for (let i = 1; i <= 6; i++) {
    const q = `/updates?limit=100&timeout=90${marker != null ? `&marker=${marker}` : ''}`;
    const updates = await get(q);
    const list = (updates && updates.updates) || [];
    if (updates && updates.marker != null) marker = updates.marker;

    if (!list.length) {
      console.log(`  ...событий нет (окно ${i}/6), продолжаю ждать`);
      continue;
    }

    for (const u of list) {
      // Поле discriminator по схеме — update_type, типы через подчёркивание
      console.log(`  ← событие: ${u.update_type}`);

      if (u.update_type === 'bot_started') {
        console.log('✅ Бот запущен (нажат «Начать»)!');
        console.log('   chat_id:', u.chat_id);
        console.log('   user_id:', u.user && u.user.user_id);
        console.log('   Данные:', JSON.stringify({ chat_id: u.chat_id, user: u.user }, null, 2));
        console.log('\nЗапишите chat_id в server/.env как MAX_CHAT_ID=...');
        process.exit(0);
      }
      if (u.update_type === 'message_created') {
        const r = (u.message && u.message.recipient) || {};
        const s = (u.message && u.message.sender) || {};
        console.log('📨 Сообщение получено.');
        console.log('   chat_id:', r.chat_id, '| sender user_id:', s.user_id);
        console.log('   (этот chat_id подходит — запишите в MAX_CHAT_ID)');
        process.exit(0);
      }
    }
    console.log(`  (получено событий: ${list.length}, ищу нужные среди них...)`);
  }
  console.log('\nСобытий не получено. Проверьте:');
  console.log('  1) нажали «Начать» именно пока скрипт ждал (не до и не после);');
  console.log('  2) сообщение отправлено ТОМУ ЖЕ боту, чей токен в server/.env;');
  console.log('  3) затем запустите скрипт снова.');
  process.exit(1);
})().catch((e) => {
  console.error('Ошибка:', e.message);
  process.exit(1);
});
