// Логика доски: даты, статусы, зависимости, группировки. Без React, проверяется тестами.

const DAY = 86400000;

export function isoDate(value) {
  const s = String(value || '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return '';
}

export function moscowToday(now = new Date()) {
  return new Date(now.getTime() + 3 * 3600000).toISOString().slice(0, 10);
}

export function addDays(iso, days) {
  return new Date(Date.parse(iso + 'T00:00:00Z') + days * DAY).toISOString().slice(0, 10);
}

export function daysBetween(from, to) {
  return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / DAY);
}

// Встречи по понедельникам. В понедельник ближайшая встреча — сегодня.
export function nextMeeting(today) {
  const weekday = new Date(today + 'T00:00:00Z').getUTCDay(); // 0 вс … 1 пн
  return addDays(today, (8 - weekday) % 7);
}

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

export function shortDate(iso) {
  if (!iso) return '';
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

export function weekdayDate(iso) {
  if (!iso) return '';
  return `${WEEKDAYS[new Date(iso + 'T00:00:00Z').getUTCDay()]}, ${shortDate(iso)}`;
}

export function statusKind(status) {
  const t = String(status || '').toLowerCase();
  if (/выполн|сделан|готов|закрыт|решен/.test(t)) return 'done';
  if (/снят|отмен/.test(t)) return 'dropped';
  if (/предвар/.test(t)) return 'draft';
  if (/принят/.test(t)) return 'accepted';
  if (/перен/.test(t)) return 'moved';
  if (/работ/.test(t)) return 'progress';
  return 'open';
}

export const isOpenKind = kind => kind === 'open' || kind === 'progress' || kind === 'moved';

export function parseDeps(text) {
  const s = String(text || '');
  if (!s.trim()) return [];
  if (!/задач|№|^[\d\s,;и]+$/i.test(s)) return [];
  return [...new Set((s.match(/\d+/g) || []).map(String))];
}

export function splitNames(text) {
  return String(text || '').split(/[,;]| и /).map(x => x.trim()).filter(Boolean);
}

const firstWord = name => String(name || '').trim().split(/\s+/)[0].toLowerCase().replace(/ё/g, 'е');

export function sameName(a, b) {
  if (!a || !b) return false;
  const x = String(a).toLowerCase().replace(/ё/g, 'е').trim();
  const y = String(b).toLowerCase().replace(/ё/g, 'е').trim();
  if (x === y) return true;
  // «Ольга» ↔ «Ольга Николаевна»: короткое имя в задачах совпадает с полным в «Участниках».
  return firstWord(x) === firstWord(y) && (x.startsWith(y + ' ') || y.startsWith(x + ' '));
}

export function buildBoard(raw, today) {
  const meetingDay = nextMeeting(today);
  const tasks = (raw.tasks || []).map(t => {
    const kind = statusKind(t.status);
    const due = isoDate(t.due);
    const open = isOpenKind(kind);
    const late = open && due && due < today ? daysBetween(due, today) : 0;
    return {
      ...t,
      id: `${isoDate(t.meeting) || 'x'}#${t.num || t.row}`,
      meeting: isoDate(t.meeting),
      due, kind, open, late,
      soon: open && !late && due && due <= meetingDay,
      depNums: parseDeps(t.deps),
    };
  });

  // Номер задачи ищем сначала на той же встрече, затем на последней предыдущей.
  const byNum = new Map();
  tasks.forEach(t => {
    if (!t.num) return;
    if (!byNum.has(t.num)) byNum.set(t.num, []);
    byNum.get(t.num).push(t);
  });
  const resolve = (num, meeting) => {
    const list = byNum.get(num) || [];
    return list.find(t => t.meeting === meeting)
      || [...list].filter(t => t.meeting <= meeting).sort((a, b) => b.meeting.localeCompare(a.meeting))[0]
      || list[0] || null;
  };
  tasks.forEach(t => {
    t.depTasks = t.depNums.map(n => resolve(n, t.meeting)).filter(Boolean).filter(d => d !== t);
    t.waitingFor = t.depTasks.filter(d => d.open);
    t.waitedBy = [];
  });
  tasks.forEach(t => { if (t.open) t.waitingFor.forEach(d => d.waitedBy.push(t)); });

  const decisions = (raw.decisions || []).map(d => ({ ...d, meeting: isoDate(d.meeting), kind: statusKind(d.status) }));
  const questions = (raw.questions || []).map(q => {
    const kind = statusKind(q.status);
    return { ...q, meeting: isoDate(q.meeting), target: isoDate(q.target), kind, open: isOpenKind(kind) };
  });
  const people = raw.people || [];

  const meetings = [...new Set([...tasks, ...decisions, ...questions].map(x => x.meeting).filter(Boolean))].sort().reverse();

  return { tasks, decisions, questions, people, meetings, today, meetingDay, generatedAt: raw.generatedAt };
}

export function byDue(a, b) {
  return (a.due || '9999').localeCompare(b.due || '9999') || Number(a.num) - Number(b.num);
}

export function weekSections(tasks) {
  const open = tasks.filter(t => t.open);
  return {
    late: open.filter(t => t.late).sort((a, b) => b.late - a.late || byDue(a, b)),
    soon: open.filter(t => t.soon).sort(byDue),
    later: open.filter(t => t.due && !t.late && !t.soon).sort(byDue),
    undated: open.filter(t => !t.due).sort(byDue),
    done: tasks.filter(t => !t.open).sort(byDue),
  };
}

// Группировка по людям. Задача «Партнёры»/«Все» остаётся отдельным исполнителем.
export function peopleIndex(board) {
  const map = new Map();
  board.tasks.forEach(t => {
    const name = t.person || 'Без исполнителя';
    if (!map.has(name)) map.set(name, { name, role: t.role, tasks: [] });
    map.get(name).tasks.push(t);
  });
  return [...map.values()].map(p => {
    const info = board.people.find(x => sameName(x.name, p.name));
    const open = p.tasks.filter(t => t.open);
    return {
      ...p,
      side: info?.side || '',
      area: info?.area || '',
      open: open.length,
      late: open.filter(t => t.late).length,
      blocking: open.filter(t => t.waitedBy.length).length,
      questions: board.questions.filter(q => q.open && splitNames(q.owner).some(n => sameName(n, p.name))),
    };
  }).sort((a, b) => b.late - a.late || b.open - a.open || a.name.localeCompare(b.name, 'ru'));
}

// Кто держит других: открытые задачи, которых ждут, сгруппированные по исполнителю.
export function blockers(board) {
  const map = new Map();
  board.tasks.filter(t => t.open && t.waitedBy.length).forEach(t => {
    if (!map.has(t.person)) map.set(t.person, []);
    map.get(t.person).push(t);
  });
  return [...map.entries()]
    .map(([person, tasks]) => ({ person, tasks: tasks.sort(byDue), waiting: tasks.reduce((n, t) => n + t.waitedBy.length, 0) }))
    .sort((a, b) => b.waiting - a.waiting);
}

export function filterByMeeting(board, meeting) {
  if (!meeting) return board;
  return {
    ...board,
    tasks: board.tasks.filter(t => t.meeting === meeting),
    decisions: board.decisions.filter(d => d.meeting === meeting),
    questions: board.questions.filter(q => q.meeting === meeting),
  };
}

export function groupBy(list, key) {
  const map = new Map();
  list.forEach(item => {
    const k = item[key] || 'Без темы';
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(item);
  });
  return [...map.entries()];
}

export function pluralTasks(n) {
  const a = n % 10, b = n % 100;
  if (a === 1 && b !== 11) return `${n} задача`;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return `${n} задачи`;
  return `${n} задач`;
}

export function pluralDays(n) {
  const a = n % 10, b = n % 100;
  if (a === 1 && b !== 11) return `${n} день`;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return `${n} дня`;
  return `${n} дней`;
}
