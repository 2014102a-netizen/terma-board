// Локальный API для проверки интерфейса: настоящий Code.gs в песочнице + local/tables.json.
// Пароль локальной проверки: dev-password. Запуск: npm run dev:api, затем в public/config.js
// временно указать http://127.0.0.1:8787 (не коммитить).
import http from 'node:http';
import fs from 'node:fs';
import { setup } from '../tests/harness.mjs';

const file = new URL('../local/tables.json', import.meta.url);
const tables = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : undefined;
const { post } = setup({ tables, password: 'dev-password' });

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.end(JSON.stringify({ ok: true, service: 'terma-board' }));
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => setTimeout(() => res.end(JSON.stringify(post(JSON.parse(body)))), 300));
}).listen(8787, '127.0.0.1', () => console.log('dev api http://127.0.0.1:8787'));
