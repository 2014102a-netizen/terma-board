import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, TEST_PASSWORD, sampleTables } from './harness.mjs';

const login = (post, extra = {}) => post({ action: 'login', password: TEST_PASSWORD, clientId: 'a', ...extra });

test('GET не отдаёт данных', () => {
  const { context } = setup();
  assert.deepEqual(Object.keys(context.doGet()).sort(), ['ok', 'service']);
});

test('без входа данных нет', () => {
  const { post } = setup();
  assert.equal(post({ action: 'board' }).error, 'expired_session');
  assert.equal(post({ action: 'board', token: '123.abc' }).error, 'expired_session');
  assert.equal(post({ action: 'nothing' }).error, 'invalid_action');
});

test('неверный пароль', () => {
  const { post } = setup();
  const res = post({ action: 'login', password: 'wrong', clientId: 'a' });
  assert.equal(res.error, 'bad_password');
  assert.equal(res.board, undefined);
});

test('пароль не задан владельцем', () => {
  const { post } = setup({ password: null });
  assert.equal(post({ action: 'login', password: '', clientId: 'a' }).error, 'not_configured');
});

test('вход выдаёт токен и доску, токен работает', () => {
  const { post } = setup();
  const res = login(post);
  assert.equal(res.ok, true);
  assert.match(res.token, /^\d{13}\.[\w-]+$/);
  assert.equal(res.board.tasks.length, 2, 'пустая строка пропущена');
  const again = post({ action: 'board', token: res.token });
  assert.equal(again.ok, true);
  assert.equal(again.board.decisions[0].text, 'Конфигурация согласована');
});

test('даты-объекты приводятся к ISO, номера к строке', () => {
  const { board } = login(setup().post);
  assert.equal(board.tasks[0].meeting, '2026-11-02');
  assert.equal(board.tasks[0].num, '1');
  assert.equal(board.tasks[1].due, '09.11.2026');
});

test('почта не выходит наружу, телефон и Telegram — только после входа', () => {
  const { post } = setup();
  const { board } = login(post);
  const text = JSON.stringify(board);
  assert.ok(!text.includes('ivan@example.org'));
  assert.deepEqual(Object.keys(board.people[0]).sort(), ['area', 'name', 'phone', 'row', 'side', 'telegram']);
  assert.equal(board.people[0].phone, '79990000000');
  assert.ok(!JSON.stringify(post({ action: 'board' })).includes('7999'));
});

test('подделанный токен отклоняется', () => {
  const { post } = setup();
  const { token } = login(post);
  const [exp, sig] = token.split('.');
  assert.equal(post({ action: 'board', token: `${Number(exp) + 1000}.${sig}` }).error, 'expired_session');
  assert.equal(post({ action: 'board', token: `${exp}.${sig.slice(0, -1)}${sig.endsWith('x') ? 'y' : 'x'}` }).error, 'expired_session');
});

test('смена пароля закрывает старые входы', () => {
  const env = setup();
  const { token } = login(env.post);
  env.props.set('GROUP_PASSWORD', 'new-password');
  assert.equal(env.post({ action: 'board', token }).error, 'expired_session');
});

test('вход живёт 90 дней', () => {
  const env = setup();
  const { token } = login(env.post);
  env.clock.now += 89 * 86400000;
  env.cache.clear();
  assert.equal(env.post({ action: 'board', token }).ok, true);
  env.clock.now += 2 * 86400000;
  assert.equal(env.post({ action: 'board', token }).error, 'expired_session');
});

test('ограничение попыток по устройству', () => {
  const { post } = setup();
  for (let i = 0; i < 8; i++) post({ action: 'login', password: 'x', clientId: 'b' });
  assert.equal(login(post, { clientId: 'b' }).error, 'rate_limit');
  assert.equal(login(post, { clientId: 'c' }).ok, true);
});

test('колонки ищутся по заголовку, лишние не выходят', () => {
  const tables = sampleTables();
  tables['Решения'] = [
    ['Статус', 'Решение', 'Тема', 'Встреча', 'Лишняя колонка'],
    ['Принято', 'Забор на блоках', 'Участок', '02.11.2026', 'секрет'],
  ];
  const { board } = login(setup({ tables }).post);
  assert.equal(board.decisions[0].text, 'Забор на блоках');
  assert.equal(board.decisions[0].by, '');
  assert.ok(!JSON.stringify(board).includes('секрет'));
});

test('нет вкладки — пустой список, а не ошибка', () => {
  const tables = sampleTables();
  delete tables['Открытые вопросы'];
  const res = login(setup({ tables }).post);
  assert.equal(res.ok, true);
  assert.deepEqual(res.board.questions, []);
});
