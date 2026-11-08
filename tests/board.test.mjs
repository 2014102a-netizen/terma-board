import test from 'node:test';
import assert from 'node:assert/strict';
import { isoDate, nextMeeting, parseDeps, statusKind, buildBoard, weekSections, peopleIndex, blockers, sameName, moscowToday, pluralTasks } from '../src/lib/board.js';

test('даты из таблицы', () => {
  assert.equal(isoDate('02.11.2026'), '2026-11-02');
  assert.equal(isoDate('2.1.2027'), '2027-01-02');
  assert.equal(isoDate('2026-11-09'), '2026-11-09');
  assert.equal(isoDate(''), '');
  assert.equal(isoDate('на неделе'), '');
});

test('день по Москве', () => {
  assert.equal(moscowToday(new Date('2026-11-08T21:30:00Z')), '2026-11-09');
  assert.equal(moscowToday(new Date('2026-11-08T20:30:00Z')), '2026-11-08');
});

test('ближайшая встреча — понедельник', () => {
  assert.equal(nextMeeting('2026-11-08'), '2026-11-09'); // вс
  assert.equal(nextMeeting('2026-11-09'), '2026-11-09'); // пн
  assert.equal(nextMeeting('2026-11-10'), '2026-11-16'); // вт
});

test('зависимости', () => {
  assert.deepEqual(parseDeps('Задачи 3, 12, 11'), ['3', '12', '11']);
  assert.deepEqual(parseDeps('Задача 25'), ['25']);
  assert.deepEqual(parseDeps('3, 4'), ['3', '4']);
  assert.deepEqual(parseDeps('ответ соседей до 15 мая'), []);
  assert.deepEqual(parseDeps(''), []);
});

test('статусы', () => {
  assert.equal(statusKind('Открыт'), 'open');
  assert.equal(statusKind('Выполнено'), 'done');
  assert.equal(statusKind('В работе'), 'progress');
  assert.equal(statusKind('Перенос'), 'moved');
  assert.equal(statusKind('Снято'), 'dropped');
  assert.equal(statusKind('Предварительно'), 'draft');
  assert.equal(statusKind('Принято'), 'accepted');
});

const raw = {
  tasks: [
    { meeting: '02.11.2026', person: 'Иван', num: '3', title: 'Расчёт А', due: '06.11.2026', status: 'Открыт' },
    { meeting: '02.11.2026', person: 'Пётр', num: '12', title: 'Расчёт Б', due: '06.11.2026', status: 'Выполнено' },
    { meeting: '02.11.2026', person: 'Иван', num: '4', title: 'Сводная таблица', due: '09.11.2026', deps: 'Задачи 3, 12', status: 'Открыт' },
    { meeting: '02.11.2026', person: 'Семён', num: '22', title: 'Заявка', due: '', deps: 'Задачи 4', status: 'Открыт' },
    { meeting: '02.11.2026', person: 'Ольга', num: '10', title: 'Эскиз', due: '20.11.2026', status: 'Открыт' },
  ],
  decisions: [{ meeting: '02.11.2026', topic: 'Тема', text: 'Решение А', status: 'Принято' }],
  questions: [{ meeting: '02.11.2026', text: 'Вопрос А', owner: 'Иван, Семён', target: '09.11.2026', status: 'Открыт' }],
  people: [{ name: 'Ольга Николаевна', side: 'Проект', area: 'Эскизы' }],
};

test('просрочка, до встречи, позже, без срока', () => {
  const board = buildBoard(raw, '2026-11-08');
  const s = weekSections(board.tasks);
  assert.deepEqual(s.late.map(t => t.num), ['3']);
  assert.equal(s.late[0].late, 2);
  assert.deepEqual(s.soon.map(t => t.num), ['4']);
  assert.deepEqual(s.later.map(t => t.num), ['10']);
  assert.deepEqual(s.undated.map(t => t.num), ['22']);
  assert.deepEqual(s.done.map(t => t.num), ['12']);
});

test('кто кого ждёт: выполненные зависимости не держат', () => {
  const board = buildBoard(raw, '2026-11-08');
  const t4 = board.tasks.find(t => t.num === '4');
  assert.deepEqual(t4.depTasks.map(t => t.num), ['3', '12']);
  assert.deepEqual(t4.waitingFor.map(t => t.num), ['3']);
  assert.deepEqual(t4.waitedBy.map(t => t.num), ['22']);
  const b = blockers(board);
  assert.equal(b[0].person, 'Иван');
  assert.equal(b[0].waiting, 2);
});

test('люди: имя из «Участников» подтягивается по первому слову', () => {
  const board = buildBoard(raw, '2026-11-08');
  const people = peopleIndex(board);
  const olga = people.find(p => p.name === 'Ольга');
  assert.equal(olga.area, 'Эскизы');
  const ivan = people.find(p => p.name === 'Иван');
  assert.equal(ivan.late, 1);
  assert.equal(ivan.questions.length, 1);
  assert.equal(people[0].name, 'Иван', 'сначала те, у кого просрочка');
});

test('совпадение имён', () => {
  assert.ok(sameName('Ольга', 'Ольга Николаевна'));
  assert.ok(sameName('Анна Сергеевна', 'Анна Сергеевна'));
  assert.ok(!sameName('Иван', 'Сергеев'));
});

test('номер задачи ищется на своей встрече, затем на прошлой', () => {
  const board = buildBoard({ tasks: [
    { meeting: '02.11.2026', num: '1', person: 'А', status: 'Открыт' },
    { meeting: '09.11.2026', num: '1', person: 'Б', status: 'Открыт' },
    { meeting: '09.11.2026', num: '2', person: 'В', deps: 'Задача 1', status: 'Открыт' },
    { meeting: '16.11.2026', num: '3', person: 'Г', deps: 'Задача 1', status: 'Открыт' },
  ] }, '2026-11-20');
  assert.equal(board.tasks[2].depTasks[0].person, 'Б');
  assert.equal(board.tasks[3].depTasks[0].person, 'Б');
});

test('склонения', () => {
  assert.equal(pluralTasks(1), '1 задача');
  assert.equal(pluralTasks(3), '3 задачи');
  assert.equal(pluralTasks(11), '11 задач');
  assert.equal(pluralTasks(22), '22 задачи');
});
