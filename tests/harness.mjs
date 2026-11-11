import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';

const code = ['Code.gs', 'Mailer.gs', 'Bot.gs']
  .map(f => fs.readFileSync(new URL('../apps-script/' + f, import.meta.url), 'utf8')).join('\n');

export const TEST_PASSWORD = 'test-only-password';

export function sampleTables() {
  return {
    'Задачи': [
      ['Встреча', 'Участник', 'Роль', '№', 'Что обещал / задача', 'Срок', 'Зависит от', 'Статус', 'Комментарий / результат'],
      [new Date('2026-11-02T00:00:00+03:00'), 'Иван', 'Проектировщик', 1, 'Посчитать нагрузки', '06.11.2026', '', 'Открыт', ''],
      ['02.11.2026', 'Пётр', 'Генподряд', 2, 'Свести нагрузки', '09.11.2026', 'Задача 1', 'Открыт', 'Ждёт Ивана'],
      ['', '', '', '', '', '', '', '', ''],
    ],
    'Решения': [
      ['Встреча', 'Тема', 'Решение', 'Кто озвучил', 'Статус', 'Комментарий'],
      ['02.11.2026', 'Здание', 'Конфигурация согласована', 'Пётр', 'Принято', ''],
    ],
    'Открытые вопросы': [
      ['Встреча', 'Тема', 'Вопрос', 'Чего не хватает для решения', 'Кто ведёт', 'К какой встрече', 'Статус'],
      ['02.11.2026', 'Газ', 'Объём котельной', 'Теплопотребление', 'Иван', '09.11.2026', 'Открыт'],
    ],
    'Участники': [
      ['Участник', 'Сторона', 'Зона ответственности', 'Контакт', 'Почта'],
      ['Иван', 'Проектировщик', 'Нагрузки', '79990000000', 'ivan@example.org'],
    ],
  };
}

export function setup({ tables = sampleTables(), password = TEST_PASSWORD, now } = {}) {
  const cache = new Map();
  const mail = [];
  const telegram = { sent: [], updates: [], triggers: [] };
  const props = new Map(password ? [['GROUP_PASSWORD', password]] : []);
  const clock = { now: now ?? Date.now() };
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock.now])); }
    static now() { return clock.now; }
  }
  const sheetApi = name => tables[name] ? {
    getDataRange: () => ({ getValues: () => tables[name].map(r => [...r]) }),
    appendRow: row => { tables[name].push([...row]); },
    hideSheet: () => { (tables.__hidden ||= []).push(name); },
  } : null;
  const book = {
    getSheetByName: sheetApi,
    insertSheet: name => { tables[name] = []; return sheetApi(name); },
  };
  const context = vm.createContext({
    Date: FakeDate, JSON, Number, String, Boolean, Error, Math, Object,
    SpreadsheetApp: { openById: () => book, getUi: () => { throw new Error('no ui'); } },
    CacheService: { getScriptCache: () => ({ get: k => cache.get(k) ?? null, put: (k, v) => cache.set(k, v), remove: k => cache.delete(k) }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props.get(k) ?? null, setProperty: (k, v) => props.set(k, v) }) },
    UrlFetchApp: { fetch: (url, opts) => {
      const method = url.split('/').pop();
      const body = JSON.parse(opts.payload);
      let result = true;
      if (method === 'sendMessage') telegram.sent.push(body);
      if (method === 'getUpdates') result = telegram.updates;
      return { getContentText: () => JSON.stringify({ ok: true, result }) };
    } },
    ScriptApp: {
      WeekDay: { MONDAY: 'MONDAY', FRIDAY: 'FRIDAY' },
      getProjectTriggers: () => telegram.triggers.map(t => ({ getHandlerFunction: () => t.fn, _t: t })),
      deleteTrigger: t => { telegram.triggers.splice(telegram.triggers.indexOf(t._t), 1); },
      newTrigger: fn => { const t = { fn }; const b = {
        timeBased: () => b, onWeekDay: d => { t.day = d; return b; }, everyDays: n => { t.every = n; return b; },
        atHour: h => { t.hour = h; return b; }, inTimezone: z => { t.tz = z; return b; },
        create: () => { telegram.triggers.push(t); return t; } }; return b; },
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (_, v) => [...crypto.createHash('sha256').update(v).digest()].map(b => (b > 127 ? b - 256 : b)),
      computeHmacSha256Signature: (v, key) => [...crypto.createHmac('sha256', key).update(v).digest()].map(b => (b > 127 ? b - 256 : b)),
      base64EncodeWebSafe: bytes => Buffer.from(bytes.map(b => b & 255)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      formatDate: (d, tz, pattern) => { const iso = new Date(d.getTime() + 10800000).toISOString(); return pattern.includes('HH') ? iso.slice(0, 10) + ' ' + iso.slice(11, 16) : iso.slice(0, 10); },
    },
    ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput: text => ({ setMimeType: () => JSON.parse(text) }) },
    Logger: { log: () => {} },
    MailApp: { sendEmail: o => mail.push(o) },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'owner@example.org' }) },
  });
  vm.runInContext(code, context);
  const post = value => context.doPost({ postData: { contents: JSON.stringify(value) } });
  return { context, post, tables, props, cache, clock, mail, telegram };
}
