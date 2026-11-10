/* ТЕРМА · Рассылка задач по почте. Второй файл того же проекта Apps Script, что и Code.gs.
 *
 * Каждый участник с адресом в колонке «Почта» вкладки «Участники» получает письмо
 * со своими открытыми задачами: что просрочено, что к встрече, кто ждёт его результата.
 *
 * previewDigest() — все письма приходят только владельцу таблицы, с пометкой, кому они ушли бы.
 * sendDigest()    — настоящая рассылка. Письма уходят с почты владельца таблицы.
 * Участник без открытых задач письма не получает.
 */
var BOARD_URL = 'https://2014102a-netizen.github.io/terma-board/';
var MAIL_FIELDS = { name: 'Участник', email: 'Почта' };

function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('ТЕРМА')
      .addItem('Письма: пробная отправка себе', 'previewDigest')
      .addItem('Письма: разослать участникам', 'sendDigest')
      .addToUi();
  } catch (error) { /* скрипт открыт не из таблицы */ }
}

function previewDigest() { return runDigest_(true); }
function sendDigest() { return runDigest_(false); }

function runDigest_(preview) {
  var book = SpreadsheetApp.openById(SPREADSHEET_ID);
  var tasks = readTab_(book, TABS.tasks);
  var people = readTab_(book, { sheet: TABS.people.sheet, fields: MAIL_FIELDS });
  var today = Utilities.formatDate(new Date(), 'Europe/Moscow', 'yyyy-MM-dd');
  var letters = buildLetters_(tasks, people, today);
  var owner = Session.getEffectiveUser().getEmail();
  letters.forEach(function(letter) {
    MailApp.sendEmail({
      to: preview ? owner : letter.email,
      subject: (preview ? '[проба → ' + letter.email + '] ' : '') + letter.subject,
      body: letter.body,
      name: 'ТЕРМА · рабочая группа'
    });
  });
  Logger.log((preview ? 'Пробная отправка себе: ' : 'Разослано: ') + letters.length + ' писем — ' +
    letters.map(function(l) { return l.name; }).join(', '));
  return { preview: preview, sent: letters.length, to: letters.map(function(l) { return l.email; }) };
}

/* ---------- Сборка писем (без обращений к Google, проверяется тестами) ---------- */

function buildLetters_(tasks, people, today) {
  var meeting = nextMonday_(today);
  var list = tasks.map(function(t) {
    return { meeting: iso_(t.meeting), person: t.person, num: String(t.num || ''), title: t.title,
      due: iso_(t.due), open: isOpen_(t.status), deps: depNums_(t.deps) };
  });
  var withEmail = people.filter(function(p) { return /@/.test(p.email || ''); });
  var letters = [];
  withEmail.forEach(function(p) {
    var mine = list.filter(function(t) { return t.open && owns_(t.person, p, withEmail); });
    if (!mine.length) return;
    var byNum = function(n) {
      var found = list.filter(function(t) { return t.num === n; });
      return found[found.length - 1] || null;
    };
    var late = [], soon = [], later = [], undated = [];
    mine.forEach(function(t) {
      if (!t.due) undated.push(t);
      else if (t.due < today) late.push(t);
      else if (t.due <= meeting) soon.push(t);
      else later.push(t);
    });
    var waitedBy = list.filter(function(o) {
      return o.open && !owns_(o.person, p, withEmail) &&
        o.deps.some(function(n) { return mine.some(function(m) { return m.num === n; }); });
    });
    var waitsFor = [];
    mine.forEach(function(m) {
      m.deps.forEach(function(n) {
        var d = byNum(n);
        if (d && d.open && !owns_(d.person, p, withEmail) && waitsFor.indexOf(d) < 0) waitsFor.push(d);
      });
    });

    var lines = [greetingName_(p.name) + ', добрый день.', '',
      'Ваши открытые задачи по проекту ТЕРМА на ' + short_(today) + '. Ближайшая встреча — ' + weekday_(meeting) + '.'];
    section_(lines, 'Просрочено', late, function(t) { return line_(t) + ' (срок ' + short_(t.due) + ')'; });
    section_(lines, 'К встрече ' + short_(meeting), soon, function(t) { return line_(t) + ' (срок ' + short_(t.due) + ')'; });
    section_(lines, 'Позже', later, function(t) { return line_(t) + ' (срок ' + short_(t.due) + ')'; });
    section_(lines, 'Срок не назван', undated, line_);
    section_(lines, 'Вашего результата ждут', waitedBy, function(t) { return '№' + t.num + ' ' + t.person + ': ' + t.title; });
    section_(lines, 'Вы ждёте от других', waitsFor, function(t) { return '№' + t.num + ' ' + t.person + ': ' + t.title; });
    lines.push('', 'Если задача сделана или срок сдвигается — ответьте на это письмо одной строкой.',
      'Все задачи, решения и открытые вопросы: ' + BOARD_URL + ' (пароль у Андрея).');

    letters.push({
      name: p.name, email: String(p.email).trim(),
      subject: 'ТЕРМА: ваши задачи к встрече ' + short_(meeting) + (late.length ? ' · просрочено ' + late.length : ''),
      body: lines.join('\n')
    });
  });
  return letters;
}

function section_(lines, title, items, format) {
  if (!items.length) return;
  lines.push('', title + ':');
  items.forEach(function(t) { lines.push('— ' + format(t)); });
}

function line_(t) { return '№' + t.num + '. ' + t.title; }

function isOpen_(status) {
  return !/выполн|сделан|готов|закрыт|снят|отмен/i.test(String(status || ''));
}

function depNums_(text) {
  var s = String(text || '');
  if (!/задач|№|^[\d\s,;и]+$/i.test(s)) return [];
  return s.match(/\d+/g) || [];
}

function iso_(value) {
  var s = String(value || '').trim();
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return '';
}

function nextMonday_(today) {
  var d = new Date(today + 'T00:00:00Z');
  var add = (8 - d.getUTCDay()) % 7;
  return new Date(d.getTime() + add * 86400000).toISOString().slice(0, 10);
}

function short_(iso) { return iso ? iso.slice(8, 10) + '.' + iso.slice(5, 7) : ''; }

function weekday_(iso) {
  return ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'][new Date(iso + 'T00:00:00Z').getUTCDay()] + ', ' + short_(iso);
}

function baseName_(name) {
  return norm_(String(name || '').replace(/\(.*\)/, ''));
}

// «Дима» ↔ «Дима (Дмитрий Епифанов)», «Александр» ↔ «Александр Пивень».
// Короткое имя засчитывается, только если среди участников с почтой оно подходит одному человеку.
function owns_(taskPerson, participant, all) {
  var t = norm_(taskPerson), p = baseName_(participant.name);
  if (!t) return false;
  if (t === p) return true;
  var prefix = function(x) { return x.indexOf(t + ' ') === 0; };
  if (!prefix(p)) return false;
  return all.filter(function(o) { return prefix(baseName_(o.name)) || baseName_(o.name) === t; }).length === 1;
}

function greetingName_(name) {
  var inside = String(name || '').match(/\(([^)]+)\)/);
  var words = String(inside ? inside[1] : name).trim().split(/\s+/);
  if (words.length > 1 && /(вна|вич|ична|ьич)$/i.test(words[1])) return words[0] + ' ' + words[1];
  return words[0];
}
