import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, sampleTables } from './harness.mjs';

function tables(withTopic = false) {
  const t = sampleTables();
  const head = ['Встреча', 'Участник', 'Роль', '№', 'Что обещал / задача', 'Срок', 'Зависит от', 'Статус', 'Комментарий / результат'];
  if (withTopic) head.push('Тема');
  const row = (r, topic) => (withTopic ? [...r, topic] : r);
  t['Задачи'] = [head,
    row(['02.11.2026', 'Иван', 'Проект', '1', 'Посчитать нагрузки', '06.11.2026', '', 'Открыт', ''], 'Сети'),
    row(['02.11.2026', 'Пётр', 'Стройка', '2', 'Свести нагрузки', '16.11.2026', 'Задача 1', 'В работе', ''], 'Сети'),
    row(['02.11.2026', 'Иван', 'Проект', '3', 'Закрыто', '05.11.2026', '', 'Выполнено', ''], 'Сети'),
    row(['09.11.2026', 'Ольга', 'Архитектор', '4', 'Эскиз', '11.11.2026', '', 'Открыт', ''], 'Планировка'),
    row(['09.11.2026', 'Ольга', 'Архитектор', '5', 'Без срока', '', '', 'Открыт', ''], 'Планировка'),
    row(['09.11.2026', 'Все', 'Группа', '6', 'Следующая встреча', '16.11.2026', '', 'Открыт', ''], ''),
    row(['09.11.2026', 'Пётр', 'Стройка', '7', 'Позже', '30.11.2026', '', 'Открыт', ''], 'Участок'),
  ];
  t['Участники'] = [
    ['Участник', 'Сторона', 'Зона ответственности', 'Контакт', 'Почта', 'Telegram'],
    ['Иван (Иван Сидоров)', '', '', '', '', '@ivan_s'],
    ['Пётр', '', '', '', '', 'petr_k'],
    ['Ольга', '', '', '', '', ''],
  ];
  t['Открытые вопросы'] = [t['Открытые вопросы'][0],
    ['09.11.2026', 'Газ', 'Где котельная', 'Мощность', 'Иван', '16.11.2026', 'Открыт'],
    ['09.11.2026', 'Участок', 'Забор', '', 'Пётр', '23.11.2026', 'Открыт'],
    ['02.11.2026', 'Парковка', 'Хватает ли мест', '', 'Иван', '09.11.2026', 'Снят'],
  ];
  return t;
}

function env(now, opts = {}) {
  const e = setup({ tables: tables(opts.topic), now: Date.parse(now) });
  e.props.set('TELEGRAM_TOKEN', 'test-token');
  if (opts.chat !== false) e.props.set('TELEGRAM_CHAT_ID', '42');
  return e;
}

test('пятница: к встрече по людям, с никами, без «Все», без закрытых и поздних', () => {
  const e = env('2026-11-13T14:00:00Z'); // пт 17:00 МСК
  e.context.botFriday();
  const text = e.telegram.sent[0].text;
  assert.match(text, /^К встрече пн, 16\.11/);
  assert.match(text, /Иван @ivan_s\n— №1 Посчитать нагрузки · просрочено 7 дн\./);
  assert.match(text, /Пётр @petr_k\n— №2 Свести нагрузки · срок 16\.11 \(ждёт №1\)/);
  assert.match(text, /Ольга\n— №4 Эскиз · просрочено 2 дн\./);
  assert.match(text, /Без срока: 1 — назначим на встрече/);
  assert.ok(!text.includes('Следующая встреча'));
  assert.ok(!text.includes('Закрыто'));
  assert.ok(!text.includes('№7'));
  assert.equal(e.telegram.sent[0].chat_id, '42');
});

test('пятница: если есть колонка «Тема» — группы по темам', () => {
  const e = env('2026-11-13T14:00:00Z', { topic: true });
  e.context.botFriday();
  const text = e.telegram.sent[0].text;
  assert.match(text, /\nСети\n— №1 Иван @ivan_s: Посчитать нагрузки/);
  assert.match(text, /\nПланировка\n— №4 Ольга: Эскиз/);
});

test('понедельник: просрочено, вопросы к встрече, кто кого держит', () => {
  const e = env('2026-11-16T06:00:00Z'); // пн 9:00 МСК
  e.context.botMonday();
  const text = e.telegram.sent[0].text;
  assert.match(text, /^Встреча сегодня, пн, 16\.11 — повестка/);
  assert.match(text, /Просрочено:\n— №1 Иван @ivan_s: Посчитать нагрузки \(срок 06\.11\)\n— №4 Ольга: Эскиз/);
  assert.match(text, /Срок сегодня:\n— №2 Пётр @petr_k: Свести нагрузки/);
  assert.match(text, /Вопросы к встрече:\n— Газ: Где котельная — ведёт Иван/);
  assert.ok(!text.includes('Забор'), 'вопрос к следующей встрече не попадает');
  assert.ok(!text.includes('Хватает ли мест'), 'снятый вопрос не попадает');
  assert.match(text, /Кто кого держит:\n— №1 Иван → ждут №2 Пётр/);
});

test('будни: пишет только когда есть срок сегодня или вчера', () => {
  let e = env('2026-11-11T06:00:00Z'); // ср 11.11
  e.context.botDaily();
  assert.equal(e.telegram.sent.length, 1);
  assert.match(e.telegram.sent[0].text, /Сегодня:\n— №4 Ольга: Эскиз/);
  e = env('2026-11-12T06:00:00Z'); // чт: вчера прошёл срок у №4
  e.context.botDaily();
  assert.match(e.telegram.sent[0].text, /Вчера прошёл срок:\n— №4 Ольга: Эскиз/);
  e = env('2026-11-19T06:00:00Z'); // чт без сроков
  e.context.botDaily();
  assert.equal(e.telegram.sent.length, 0);
});

test('будни: в выходные и понедельник молчит', () => {
  for (const day of ['2026-11-14T06:00:00Z', '2026-11-15T06:00:00Z', '2026-11-16T06:00:00Z']) {
    const e = env(day);
    e.context.botDaily();
    assert.equal(e.telegram.sent.length, 0, day);
  }
});

test('connectMe запоминает личный чат и здоровается', () => {
  const e = env('2026-11-10T20:00:00Z', { chat: false });
  e.telegram.updates.push({ message: { chat: { id: 777, type: 'private', first_name: 'А' }, text: '/start' } });
  e.telegram.updates.push({ message: { chat: { id: -100, type: 'supergroup', title: 'Группа' }, text: 'привет' } });
  e.context.connectMe();
  assert.equal(e.props.get('TELEGRAM_CHAT_ID'), '777');
  assert.match(e.telegram.sent[0].text, /Бот подключён/);
  e.context.connectGroup();
  assert.equal(e.props.get('TELEGRAM_CHAT_ID'), '-100');
});

test('без /start — понятная ошибка, без токена — тоже', () => {
  const e = env('2026-11-10T20:00:00Z', { chat: false });
  assert.throws(() => e.context.connectMe(), /Напишите ему \/start/);
  e.props.delete('TELEGRAM_TOKEN');
  assert.throws(() => e.context.connectMe(), /TELEGRAM_TOKEN/);
});

test('расписание: три триггера по Москве, повторная установка не плодит дубли', () => {
  const e = env('2026-11-10T20:00:00Z');
  e.context.installBotSchedule();
  e.context.installBotSchedule();
  const t = e.telegram.triggers;
  assert.equal(t.length, 3);
  assert.deepEqual(t.map(x => [x.fn, x.day || 'daily', x.hour, x.tz]), [
    ['botFriday', 'FRIDAY', 17, 'Europe/Moscow'],
    ['botMonday', 'MONDAY', 9, 'Europe/Moscow'],
    ['botDaily', 'daily', 9, 'Europe/Moscow'],
  ]);
  e.context.stopBot();
  assert.equal(e.telegram.triggers.length, 0);
});

test('длинное сообщение режется на части по строкам', () => {
  const e = env('2026-11-10T20:00:00Z');
  const long = Array.from({ length: 300 }, (_, i) => 'строка ' + i + ' ' + 'х'.repeat(20)).join('\n');
  const parts = e.context.botChunks_(long, 3900);
  assert.ok(parts.length > 1);
  assert.ok(parts.every(p => p.length <= 3900));
  assert.equal(parts.join('\n'), long);
});

test('testBot присылает пробу и три сообщения', () => {
  const e = env('2026-11-10T20:00:00Z');
  e.context.testBot();
  e.props.set('TELEGRAM_OWNER_CHAT_ID', '777');
  e.context.testBot();
  assert.equal(e.telegram.sent.length, 4 + 5);
});

test('сводка активности: только владельцу, дни за неделю, кто не открывал', () => {
  const e = env('2026-11-16T06:00:00Z');
  e.props.set('TELEGRAM_OWNER_CHAT_ID', '777');
  e.tables['Журнал'] = [['Время', 'Кто', 'Устройство'],
    ['2026-11-10 09:00', 'Иван (Иван Сидоров)', 'a'], ['2026-11-10 18:00', 'Иван (Иван Сидоров)', 'a'],
    ['2026-11-12 09:00', 'Иван (Иван Сидоров)', 'a'], ['2026-11-13 10:00', 'Ольга', 'b'],
    ['2026-11-01 10:00', 'Пётр', 'c'], ['2026-11-16 08:00', 'Пётр', 'c']];
  e.context.botMonday();
  assert.equal(e.telegram.sent.length, 2);
  assert.equal(e.telegram.sent[0].chat_id, '42');
  const report = e.telegram.sent[1];
  assert.equal(report.chat_id, '777');
  assert.match(report.text, /^Доска за неделю, 09\.11–15\.11/);
  assert.match(report.text, /— Иван \(Иван Сидоров\) — 2 дня\n— Ольга — 1 день/);
  assert.match(report.text, /не открывали: Пётр/);
});

test('без личного чата владельца сводка не уходит никуда', () => {
  const e = env('2026-11-16T06:00:00Z');
  e.context.botMonday();
  assert.equal(e.telegram.sent.length, 1);
});

test('connectMe запоминает владельца, connectGroup его не трогает', () => {
  const e = env('2026-11-10T20:00:00Z', { chat: false });
  e.telegram.updates.push({ message: { chat: { id: 777, type: 'private' }, text: '/start' } });
  e.telegram.updates.push({ message: { chat: { id: -100, type: 'group', title: 'Г' }, text: 'x' } });
  e.context.connectMe();
  e.context.connectGroup();
  assert.equal(e.props.get('TELEGRAM_OWNER_CHAT_ID'), '777');
  assert.equal(e.props.get('TELEGRAM_CHAT_ID'), '-100');
});
