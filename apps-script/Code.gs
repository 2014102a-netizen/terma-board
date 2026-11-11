/* ТЕРМА · Рабочая группа. Apps Script, привязанный к таблице задач и обещаний.
 *
 * Пароль задаёт владелец: «Настройки проекта → Свойства скрипта → GROUP_PASSWORD».
 * В коде, на сайте и в репозитории паролей и данных нет.
 * Смена пароля сразу закрывает все выданные входы.
 *
 * Таблицу скрипт только читает. Единственная запись — строка во вкладку «Журнал»
 * (скрытая): кто и когда открывал доску, не чаще раза в час с одного телефона.
 * Колонки ищутся по заголовкам, порядок колонок можно менять.
 * После входа отдаются телефон («Контакт») и Telegram участников — для кнопок связи на доске.
 * Колонка «Почта» наружу не отдаётся никогда: она нужна только рассылке (Mailer.gs).
 */
var SPREADSHEET_ID = '1W2cPtOLtnWWpU8ivv61oOKSDgyiJYjVjkG_Gj8yGVCc';
var SESSION_DAYS = 90;
var CACHE_SECONDS = 30;
var MAX_FAILS_CLIENT = 8;
var MAX_FAILS_GLOBAL = 40;
var LOG_SHEET = 'Журнал';

var TABS = {
  tasks: { sheet: 'Задачи', fields: {
    meeting: 'Встреча', person: 'Участник', role: 'Роль', num: '№', title: 'Что обещал / задача',
    due: 'Срок', deps: 'Зависит от', status: 'Статус', comment: 'Комментарий / результат' } },
  decisions: { sheet: 'Решения', fields: {
    meeting: 'Встреча', topic: 'Тема', text: 'Решение', by: 'Кто озвучил', status: 'Статус', comment: 'Комментарий' } },
  questions: { sheet: 'Открытые вопросы', fields: {
    meeting: 'Встреча', topic: 'Тема', text: 'Вопрос', missing: 'Чего не хватает для решения',
    owner: 'Кто ведёт', target: 'К какой встрече', status: 'Статус' } },
  people: { sheet: 'Участники', fields: {
    name: 'Участник', side: 'Сторона', area: 'Зона ответственности', phone: 'Контакт', telegram: 'Telegram' } }
};

function doGet() {
  return json_({ ok: true, service: 'terma-board' });
}

function doPost(e) {
  try {
    var raw = e && e.postData && e.postData.contents || '';
    if (raw.length > 4000) return json_({ ok: false, error: 'invalid_request' });
    var req = JSON.parse(raw);
    if (req.action === 'login') return json_(login_(req));
    if (req.action === 'board') {
      if (!verifyToken_(req.token)) return json_({ ok: false, error: 'expired_session' });
      var board = board_();
      logVisit_(req, board);
      return json_({ ok: true, board: board });
    }
    return json_({ ok: false, error: 'invalid_action' });
  } catch (error) {
    return json_({ ok: false, error: 'request_failed' });
  }
}

/* ---------- Вход ---------- */

function login_(req) {
  var password = password_();
  if (!password) return { ok: false, error: 'not_configured' };
  var cache = CacheService.getScriptCache();
  var client = 'fail:' + hash_(String(req.clientId || 'anonymous').slice(0, 100));
  var clientFails = Number(cache.get(client) || 0);
  var globalFails = Number(cache.get('fail:all') || 0);
  if (clientFails >= MAX_FAILS_CLIENT || globalFails >= MAX_FAILS_GLOBAL) return { ok: false, error: 'rate_limit' };
  if (!safeEqual_(hash_(String(req.password || '')), hash_(password))) {
    cache.put(client, String(clientFails + 1), 600);
    cache.put('fail:all', String(globalFails + 1), 600);
    return { ok: false, error: 'bad_password' };
  }
  cache.remove(client);
  var expiresAt = Date.now() + SESSION_DAYS * 86400000;
  return { ok: true, token: expiresAt + '.' + sign_(String(expiresAt)), expiresAt: expiresAt, board: board_() };
}

function password_() {
  return PropertiesService.getScriptProperties().getProperty('GROUP_PASSWORD');
}

function sign_(value) {
  var props = PropertiesService.getScriptProperties();
  var secret = String(password_()) + '|' + String(props.getProperty('SESSION_SALT') || 'terma');
  var bytes = Utilities.computeHmacSha256Signature(value, secret);
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '');
}

function verifyToken_(token) {
  if (!password_()) return false;
  if (typeof token !== 'string' || token.length > 200) return false;
  var parts = token.split('.');
  if (parts.length !== 2 || !/^\d{13}$/.test(parts[0])) return false;
  if (Number(parts[0]) < Date.now()) return false;
  return safeEqual_(sign_(parts[0]), parts[1]);
}

function hash_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8)
    .map(function(b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}

function safeEqual_(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ---------- Данные ---------- */

function board_() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('board');
  if (cached) return JSON.parse(cached);
  var book = SpreadsheetApp.openById(SPREADSHEET_ID);
  var board = { generatedAt: new Date().toISOString() };
  Object.keys(TABS).forEach(function(key) { board[key] = readTab_(book, TABS[key]); });
  var text = JSON.stringify(board);
  if (text.length < 90000) cache.put('board', text, CACHE_SECONDS);
  return board;
}

function norm_(value) {
  return String(value || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

function cell_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') return Utilities.formatDate(value, 'Europe/Moscow', 'yyyy-MM-dd');
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function readTab_(book, tab) {
  var sheet = book.getSheetByName(tab.sheet);
  if (!sheet) return [];
  var values = sheet.getDataRange().getValues();
  if (!values.length) return [];
  var header = values[0].map(norm_);
  var index = {};
  Object.keys(tab.fields).forEach(function(key) { index[key] = header.indexOf(norm_(tab.fields[key])); });
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var item = {}, filled = false;
    Object.keys(index).forEach(function(key) {
      var v = index[key] >= 0 ? cell_(values[r][index[key]]) : '';
      item[key] = v;
      if (v) filled = true;
    });
    if (filled) { item.row = r + 1; rows.push(item); }
  }
  return rows;
}

/* ---------- Журнал открытий ---------- */

// Пишет «время · кто · устройство». Имя принимается, только если оно есть во вкладке «Участники».
// Сбой журнала никогда не мешает доске открыться.
function logVisit_(req, board) {
  try {
    var who = String(req.who || '').trim();
    if (!who || !board.people.some(function(p) { return p.name === who; })) return;
    var device = hash_(String(req.clientId || 'anonymous').slice(0, 100)).slice(0, 6);
    var cache = CacheService.getScriptCache();
    var key = 'seen:' + device + ':' + hash_(who).slice(0, 8);
    if (cache.get(key)) return;
    cache.put(key, '1', 3600);
    var book = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = book.getSheetByName(LOG_SHEET);
    if (!sheet) {
      sheet = book.insertSheet(LOG_SHEET);
      sheet.appendRow(['Время', 'Кто', 'Устройство']);
      sheet.hideSheet();
    }
    sheet.appendRow([Utilities.formatDate(new Date(), 'Europe/Moscow', 'yyyy-MM-dd HH:mm'), who, device]);
  } catch (error) { /* журнал не критичен */ }
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

/* Проверка из редактора владельцем: показывает число строк, пароль не выводит. */
function checkSetup() {
  var board = board_();
  Logger.log('Пароль задан: ' + Boolean(password_()));
  Logger.log('Задач: ' + board.tasks.length + ', решений: ' + board.decisions.length +
    ', вопросов: ' + board.questions.length + ', участников: ' + board.people.length);
}
