import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';

const code = fs.readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');

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
  const props = new Map(password ? [['GROUP_PASSWORD', password]] : []);
  const clock = { now: now ?? Date.now() };
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock.now])); }
    static now() { return clock.now; }
  }
  const sheetApi = name => tables[name] ? {
    getDataRange: () => ({ getValues: () => tables[name].map(r => [...r]) }),
  } : null;
  const context = vm.createContext({
    Date: FakeDate, JSON, Number, String, Boolean, Error, Math, Object,
    SpreadsheetApp: { openById: () => ({ getSheetByName: sheetApi }) },
    CacheService: { getScriptCache: () => ({ get: k => cache.get(k) ?? null, put: (k, v) => cache.set(k, v), remove: k => cache.delete(k) }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props.get(k) ?? null }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (_, v) => [...crypto.createHash('sha256').update(v).digest()].map(b => (b > 127 ? b - 256 : b)),
      computeHmacSha256Signature: (v, key) => [...crypto.createHmac('sha256', key).update(v).digest()].map(b => (b > 127 ? b - 256 : b)),
      base64EncodeWebSafe: bytes => Buffer.from(bytes.map(b => b & 255)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      formatDate: (d, tz, pattern) => new Date(d.getTime() + 10800000).toISOString().slice(0, 10),
    },
    ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput: text => ({ setMimeType: () => JSON.parse(text) }) },
    Logger: { log: () => {} },
  });
  vm.runInContext(code, context);
  const post = value => context.doPost({ postData: { contents: JSON.stringify(value) } });
  return { context, post, tables, props, cache, clock };
}
