/* ТЕРМА · Telegram-бот рабочей группы. Третий файл того же проекта Apps Script.
 *
 * Свойства скрипта:
 *   TELEGRAM_TOKEN    — токен от @BotFather (кладёт владелец, в коде его нет);
 *   TELEGRAM_CHAT_ID  — куда писать напоминания; задаётся connectMe() или connectGroup().
 *   TELEGRAM_OWNER_CHAT_ID — личный чат владельца; задаётся connectMe(). Туда, и только туда,
 *                            по понедельникам уходит сводка «кто открывал доску».
 *
 * Порядок запуска:
 *   1. Написать боту /start → выполнить connectMe(): бот запомнит личный чат владельца.
 *   2. testBot(): прислать все три сообщения сразу, посмотреть глазами.
 *   3. installBotSchedule(): включить расписание (пт 17:00, пн 9:00, будни 9:00 — по поводу).
 *   4. Позже: добавить бота в группу, написать там что-нибудь → connectGroup().
 * stopBot() снимает расписание.
 *
 * Бот только читает таблицу и пишет в чат. Задачи он не закрывает и сроки не меняет.
 */
var BOT_BOARD_URL = 'https://2014102a-netizen.github.io/terma-board/';
var BOT_HANDLERS = ['botFriday', 'botMonday', 'botDaily'];
var BOT_TZ = 'Europe/Moscow';

/* ---------- Подключение и расписание ---------- */

function connectMe() {
  var id = connectChat_(['private'], 'Бот подключён. Напоминания по задачам будут приходить сюда.');
  PropertiesService.getScriptProperties().setProperty('TELEGRAM_OWNER_CHAT_ID', String(id));
  return id;
}
function connectGroup() { return connectChat_(['group', 'supergroup'], 'Бот подключён к группе. Здесь будут напоминания по задачам рабочей группы.'); }

function connectChat_(types, hello) {
  var updates = botApi_('getUpdates', {}).result || [];
  var chat = null;
  updates.forEach(function(u) {
    var m = u.message || u.my_chat_member || u.channel_post;
    if (m && m.chat && types.indexOf(m.chat.type) >= 0) chat = m.chat;
  });
  if (!chat) throw new Error(types[0] === 'private'
    ? 'Не вижу личного сообщения боту. Напишите ему /start и запустите ещё раз.'
    : 'Не вижу сообщений из группы. Добавьте бота в группу, напишите там любое сообщение и запустите ещё раз.');
  PropertiesService.getScriptProperties().setProperty('TELEGRAM_CHAT_ID', String(chat.id));
  sendTelegram_(hello);
  Logger.log('Чат подключён: ' + (chat.title || chat.username || chat.first_name || chat.id));
  return chat.id;
}

function installBotSchedule() {
  stopBot();
  ScriptApp.newTrigger('botFriday').timeBased().onWeekDay(ScriptApp.WeekDay.FRIDAY).atHour(17).inTimezone(BOT_TZ).create();
  ScriptApp.newTrigger('botMonday').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(9).inTimezone(BOT_TZ).create();
  ScriptApp.newTrigger('botDaily').timeBased().everyDays(1).atHour(9).inTimezone(BOT_TZ).create();
  Logger.log('Расписание включено: пт 17:00, пн 9:00, будни 9:00 (только если есть сроки).');
}

function stopBot() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (BOT_HANDLERS.indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
}

function testBot() {
  var data = botData_();
  sendTelegram_('Проба. Так будут выглядеть сообщения бота.');
  sendTelegram_(fridayText_(data.tasks, data.people, data.today));
  sendTelegram_(mondayText_(data.tasks, data.people, data.questions, data.today));
  sendTelegram_(dailyText_(data.tasks, data.people, data.today) || 'Ежедневное: сегодня сроков нет — в такой день бот молчит.');
  sendOwner_(activityText_(data.visits, data.tasks, data.today));
}

/* ---------- Запуск по расписанию ---------- */

function botFriday() { var d = botData_(); sendTelegram_(fridayText_(d.tasks, d.people, d.today)); }
function botMonday() {
  var d = botData_();
  sendTelegram_(mondayText_(d.tasks, d.people, d.questions, d.today));
  try { sendOwner_(activityText_(d.visits, d.tasks, d.today)); } catch (error) { Logger.log(error); }
}

function botDaily() {
  var d = botData_();
  var weekday = new Date(d.today + 'T00:00:00Z').getUTCDay();
  if (weekday === 0 || weekday === 1 || weekday === 6) return; // выходные; в понедельник есть повестка
  var text = dailyText_(d.tasks, d.people, d.today);
  if (text) sendTelegram_(text);
}

function botData_() {
  var book = SpreadsheetApp.openById(SPREADSHEET_ID);
  var taskFields = {};
  Object.keys(TABS.tasks.fields).forEach(function(k) { taskFields[k] = TABS.tasks.fields[k]; });
  taskFields.topic = 'Тема';
  return {
    tasks: readTab_(book, { sheet: TABS.tasks.sheet, fields: taskFields }),
    people: readTab_(book, { sheet: TABS.people.sheet, fields: { name: 'Участник', telegram: 'Telegram' } }),
    questions: readTab_(book, TABS.questions),
    visits: readTab_(book, { sheet: 'Журнал', fields: { time: 'Время', who: 'Кто' } }),
    today: Utilities.formatDate(new Date(), BOT_TZ, 'yyyy-MM-dd')
  };
}

/* ---------- Тексты (без обращений к Google, проверяются тестами) ---------- */

function fridayText_(rawTasks, people, today) {
  var meeting = botNextMonday_(today);
  var tasks = botTasks_(rawTasks).filter(function(t) { return t.open && !botGeneric_(t.person); });
  var due = tasks.filter(function(t) { return t.due && t.due <= meeting; });
  var undated = tasks.filter(function(t) { return !t.due; }).length;
  var lines = ['К встрече ' + botWeekday_(meeting)];
  if (!due.length) lines.push('', 'Задач со сроком к встрече нет.');
  botGroups_(due, people).forEach(function(g) {
    lines.push('', g.title);
    g.items.forEach(function(t) {
      lines.push('— №' + t.num + ' ' + t.title + ' · ' + botDueNote_(t, today) + botWaitNote_(t, tasks));
    });
  });
  if (undated) lines.push('', 'Без срока: ' + undated + ' — назначим на встрече.');
  lines.push('', 'Не успеваете — ответьте на это сообщение: «№… переношу на …, причина».', 'Доска: ' + BOT_BOARD_URL);
  return lines.join('\n');
}

function mondayText_(rawTasks, people, rawQuestions, today) {
  var tasks = botTasks_(rawTasks).filter(function(t) { return t.open && !botGeneric_(t.person); });
  var late = tasks.filter(function(t) { return t.due && t.due < today; });
  var todayDue = tasks.filter(function(t) { return t.due === today; });
  var questions = (rawQuestions || []).filter(function(q) {
    var target = botIso_(q.target);
    return botOpen_(q.status) && target && target <= today;
  });
  var holders = [];
  tasks.forEach(function(t) {
    var waiting = tasks.filter(function(o) { return o !== t && o.person !== t.person && o.deps.indexOf(t.num) >= 0; });
    if (waiting.length) holders.push({ task: t, waiting: waiting });
  });
  var lines = ['Встреча сегодня, ' + botWeekday_(today) + ' — повестка'];
  botBlock_(lines, 'Просрочено', late, function(t) {
    return '№' + t.num + ' ' + botWho_(t.person, people) + ': ' + t.title + ' (срок ' + botShort_(t.due) + ')';
  });
  botBlock_(lines, 'Срок сегодня', todayDue, function(t) { return '№' + t.num + ' ' + botWho_(t.person, people) + ': ' + t.title; });
  botBlock_(lines, 'Вопросы к встрече', questions, function(q) {
    return (q.topic ? q.topic + ': ' : '') + q.text + (q.owner ? ' — ведёт ' + q.owner : '');
  });
  botBlock_(lines, 'Кто кого держит', holders, function(h) {
    return '№' + h.task.num + ' ' + h.task.person + ' → ждут ' +
      h.waiting.map(function(w) { return '№' + w.num + ' ' + w.person; }).join(', ');
  });
  if (lines.length === 1) lines.push('', 'Просроченных задач и вопросов к встрече нет.');
  lines.push('', 'Доска: ' + BOT_BOARD_URL);
  return lines.join('\n');
}

// Будни: срок сегодня и срок, прошедший вчера. Пусто — бот молчит.
function dailyText_(rawTasks, people, today) {
  var yesterday = new Date(Date.parse(today + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
  var tasks = botTasks_(rawTasks).filter(function(t) { return t.open && !botGeneric_(t.person); });
  var now = tasks.filter(function(t) { return t.due === today; });
  var missed = tasks.filter(function(t) { return t.due === yesterday; });
  if (!now.length && !missed.length) return '';
  var lines = ['Сроки, ' + botWeekday_(today)];
  var fmt = function(t) { return '№' + t.num + ' ' + botWho_(t.person, people) + ': ' + t.title; };
  botBlock_(lines, 'Сегодня', now, fmt);
  botBlock_(lines, 'Вчера прошёл срок', missed, fmt);
  lines.push('', 'Сделано — ответьте «№… — готово». Не успеваете — «№… переношу на …».');
  return lines.join('\n');
}

// Только владельцу: кто открывал доску за 7 дней до сегодняшнего. «Ни разу» — у кого есть открытые задачи.
function activityText_(visits, rawTasks, today) {
  var from = new Date(Date.parse(today + 'T00:00:00Z') - 7 * 86400000).toISOString().slice(0, 10);
  var days = {};
  (visits || []).forEach(function(v) {
    var day = botIso_(v.time);
    if (!v.who || !day || day < from || day >= today) return;
    days[v.who] = days[v.who] || {};
    days[v.who][day] = true;
  });
  var seen = Object.keys(days).map(function(name) { return { name: name, n: Object.keys(days[name]).length }; })
    .sort(function(a, b) { return b.n - a.n || a.name.localeCompare(b.name); });
  var owners = [];
  botTasks_(rawTasks).forEach(function(t) {
    if (t.open && t.person && !botGeneric_(t.person) && owners.indexOf(t.person) < 0) owners.push(t.person);
  });
  var base = function(n) { return norm_(String(n || '').replace(/\(.*\)/, '')); };
  var never = owners.filter(function(person) {
    var t = norm_(person);
    return !seen.some(function(s) { var b = base(s.name); return b === t || b.indexOf(t + ' ') === 0; });
  });
  var lines = ['Доска за неделю, ' + botShort_(from) + '–' + botShort_(new Date(Date.parse(today) - 86400000).toISOString().slice(0, 10))];
  if (seen.length) {
    lines.push('', 'Открывали:');
    seen.forEach(function(s) { lines.push('— ' + s.name + ' — ' + s.n + ' ' + (s.n === 1 ? 'день' : s.n < 5 ? 'дня' : 'дней')); });
  } else lines.push('', 'Никто не открывал.');
  if (never.length) lines.push('', 'С открытыми задачами, но не открывали: ' + never.join(', '));
  return lines.join('\n');
}

function sendOwner_(text) {
  var owner = PropertiesService.getScriptProperties().getProperty('TELEGRAM_OWNER_CHAT_ID');
  if (owner) sendTelegramTo_(owner, text);
}

/* ---------- Помощники ---------- */

function botTasks_(raw) {
  return (raw || []).map(function(t) {
    return { num: String(t.num || ''), person: String(t.person || ''), title: t.title, topic: t.topic || '',
      due: botIso_(t.due), open: botOpen_(t.status), deps: botDeps_(t.deps) };
  });
}

function botGroups_(tasks, people) {
  var byTopic = tasks.some(function(t) { return t.topic; });
  var groups = [];
  tasks.forEach(function(t) {
    var key = byTopic ? (t.topic || 'Прочее') : t.person;
    var g = groups.filter(function(x) { return x.key === key; })[0];
    if (!g) { g = { key: key, title: byTopic ? key : botWho_(t.person, people), items: [] }; groups.push(g); }
    g.items.push(byTopic ? Object.assign({}, t, { title: botWho_(t.person, people) + ': ' + t.title }) : t);
  });
  groups.forEach(function(g) {
    g.items.sort(function(a, b) { return (a.due || '9').localeCompare(b.due || '9') || Number(a.num) - Number(b.num); });
  });
  return groups;
}

function botDueNote_(t, today) {
  if (t.due < today) return 'просрочено ' + Math.round((Date.parse(today) - Date.parse(t.due)) / 86400000) + ' дн.';
  if (t.due === today) return 'срок сегодня';
  return 'срок ' + botShort_(t.due);
}

function botWaitNote_(t, tasks) {
  var waits = t.deps.filter(function(n) {
    return tasks.some(function(o) { return o.num === n && o.open && o !== t; });
  });
  return waits.length ? ' (ждёт №' + waits.join(', №') + ')' : '';
}

function botBlock_(lines, title, items, format) {
  if (!items.length) return;
  lines.push('', title + ':');
  items.forEach(function(x) { lines.push('— ' + format(x)); });
}

// Имя из задачи → «Сергей» или «Сергей @nick», если ник есть и имя узнаётся однозначно.
function botWho_(person, people) {
  var t = norm_(person);
  var base = function(n) { return norm_(String(n || '').replace(/\(.*\)/, '')); };
  var match = (people || []).filter(function(p) {
    var b = base(p.name);
    return b === t || b.indexOf(t + ' ') === 0;
  });
  var nick = match.length === 1 ? String(match[0].telegram || '').trim() : '';
  if (nick && nick.charAt(0) !== '@') nick = '@' + nick;
  return /^@[A-Za-z][A-Za-z0-9_]{3,31}$/.test(nick) ? person + ' ' + nick : person;
}

function botGeneric_(person) { return /^(все|партн[её]ры)$/i.test(String(person || '').trim()); }
function botOpen_(status) { return !/выполн|сделан|готов|закрыт|снят|отмен|решен/i.test(String(status || '')); }

function botDeps_(text) {
  var s = String(text || '');
  if (!/задач|№|^[\d\s,;и]+$/i.test(s)) return [];
  return s.match(/\d+/g) || [];
}

function botIso_(value) {
  var s = String(value || '').trim();
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return '';
}

function botNextMonday_(today) {
  var d = new Date(today + 'T00:00:00Z');
  return new Date(d.getTime() + ((8 - d.getUTCDay()) % 7) * 86400000).toISOString().slice(0, 10);
}

function botShort_(iso) { return iso ? iso.slice(8, 10) + '.' + iso.slice(5, 7) : ''; }

function botWeekday_(iso) {
  return ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'][new Date(iso + 'T00:00:00Z').getUTCDay()] + ', ' + botShort_(iso);
}

/* ---------- Telegram ---------- */

function sendTelegram_(text) {
  var chatId = PropertiesService.getScriptProperties().getProperty('TELEGRAM_CHAT_ID');
  if (!chatId) throw new Error('Чат не подключён: запустите connectMe() или connectGroup().');
  sendTelegramTo_(chatId, text);
}

function sendTelegramTo_(chatId, text) {
  botChunks_(text, 3900).forEach(function(part) {
    botApi_('sendMessage', { chat_id: chatId, text: part, disable_web_page_preview: true });
  });
}

function botChunks_(text, limit) {
  var parts = [], current = '';
  String(text).split('\n').forEach(function(line) {
    if ((current + '\n' + line).length > limit && current) { parts.push(current); current = line; }
    else current = current ? current + '\n' + line : line;
  });
  if (current) parts.push(current);
  return parts;
}

function botApi_(method, payload) {
  var token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_TOKEN');
  if (!token) throw new Error('Нет TELEGRAM_TOKEN в свойствах скрипта.');
  var response = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/' + method, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true
  });
  var data = JSON.parse(response.getContentText());
  if (!data.ok) throw new Error('Telegram: ' + (data.description || 'ошибка') + ' (' + method + ')');
  return data;
}
