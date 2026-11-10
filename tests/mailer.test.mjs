import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, sampleTables } from './harness.mjs';

function tables() {
  const t = sampleTables();
  t['Задачи'] = [
    t['Задачи'][0],
    ['02.11.2026', 'Иван', 'Проект', '1', 'Посчитать нагрузки', '06.11.2026', '', 'Открыт', ''],
    ['02.11.2026', 'Пётр', 'Стройка', '2', 'Свести нагрузки', '16.11.2026', 'Задача 1', 'В работе', ''],
    ['02.11.2026', 'Иван', 'Проект', '3', 'Закрытая задача', '05.11.2026', '', 'Выполнено', ''],
    ['09.11.2026', 'Иван', 'Проект', '4', 'Без срока', '', '', 'Открыт', ''],
    ['09.11.2026', 'Ольга', 'Архитектор', '5', 'Эскиз', '20.11.2026', 'Задача 2', 'Открыт', ''],
  ];
  t['Участники'] = [
    ['Участник', 'Сторона', 'Зона ответственности', 'Контакт', 'Почта', 'Telegram'],
    ['Иван (Иван Сидоров)', 'Проект', '', '79990000000', 'ivan@example.org', '@ivan'],
    ['Пётр Петров', 'Стройка', '', '', 'petr@example.org', ''],
    ['Ольга', 'Архитектор', '', '', '', ''],
    ['Анна Сергеевна', 'Заказчик', '', '', 'anna@example.org', ''],
  ];
  return t;
}

const NOW = Date.parse('2026-11-10T10:00:00Z');

test('проба уходит только владельцу, с пометкой адресата', () => {
  const env = setup({ tables: tables(), now: NOW });
  const res = env.context.previewDigest();
  assert.equal(res.preview, true);
  assert.equal(env.mail.length, 2, 'Иван и Пётр; у Анны нет задач, у Ольги нет почты');
  assert.ok(env.mail.every(m => m.to === 'owner@example.org'));
  assert.match(env.mail[0].subject, /^\[проба → ivan@example.org\]/);
});

test('рассылка: каждому свои задачи, без закрытых и чужих', () => {
  const env = setup({ tables: tables(), now: NOW });
  env.context.sendDigest();
  const ivan = env.mail.find(m => m.to === 'ivan@example.org');
  assert.ok(ivan);
  assert.match(ivan.body, /^Иван, добрый день/);
  assert.match(ivan.body, /Просрочено:\n— №1\. Посчитать нагрузки \(срок 06\.11\)/);
  assert.match(ivan.body, /Срок не назван:\n— №4\. Без срока/);
  assert.match(ivan.body, /Вашего результата ждут:\n— №2 Пётр: Свести нагрузки/);
  assert.ok(!ivan.body.includes('Закрытая задача'));
  assert.ok(!ivan.body.includes('Эскиз'));
  assert.match(ivan.subject, /к встрече 16\.11 · просрочено 1/);
  const petr = env.mail.find(m => m.to === 'petr@example.org');
  assert.match(petr.body, /К встрече 16\.11:\n— №2\. Свести нагрузки/);
  assert.match(petr.body, /Вы ждёте от других:\n— №1 Иван: Посчитать нагрузки/);
  assert.match(petr.body, /Вашего результата ждут:\n— №5 Ольга: Эскиз/);
});

test('в письмах нет чужих телефонов и почт', () => {
  const env = setup({ tables: tables(), now: NOW });
  env.context.sendDigest();
  for (const m of env.mail) {
    assert.ok(!m.body.includes('79990000000'));
    assert.ok(!m.body.includes('@ivan'));
    for (const other of ['ivan@example.org', 'petr@example.org', 'anna@example.org']) {
      if (other !== m.to) assert.ok(!m.body.includes(other), `${other} в письме для ${m.to}`);
    }
  }
});

test('короткое имя не засчитывается, если подходит двум участникам с почтой', () => {
  const t = tables();
  t['Задачи'].push(['09.11.2026', 'Александр', 'Бассейн', '6', 'Концепция', '', '', 'Открыт', '']);
  t['Участники'].push(['Александр Пивень', 'Бассейн', '', '', 'a1@example.org', '']);
  let env = setup({ tables: t, now: NOW });
  env.context.sendDigest();
  assert.ok(env.mail.some(m => m.to === 'a1@example.org'), 'один Александр с почтой — письмо ему');
  t['Участники'].push(['Александр Журавлёв', 'Setl', '', '', 'a2@example.org', '']);
  env = setup({ tables: t, now: NOW });
  env.context.sendDigest();
  assert.ok(!env.mail.some(m => m.to === 'a1@example.org' || m.to === 'a2@example.org'), 'двое — никому, чтобы не перепутать');
});

test('обращение по имени и отчеству', () => {
  const env = setup({ tables: tables(), now: NOW });
  assert.equal(env.context.greetingName_('Тамара Андреевна'), 'Тамара Андреевна');
  assert.equal(env.context.greetingName_('Дима (Дмитрий Епифанов)'), 'Дмитрий');
  assert.equal(env.context.greetingName_('Андрей Ефремов'), 'Андрей');
});

test('веб-доска по-прежнему не отдаёт почты', () => {
  const env = setup({ tables: tables(), now: NOW });
  const res = env.post({ action: 'login', password: 'test-only-password', clientId: 'x' });
  assert.ok(!JSON.stringify(res.board).includes('@example.org'));
  assert.ok(!JSON.stringify(res.board).includes('@ivan'));
});
