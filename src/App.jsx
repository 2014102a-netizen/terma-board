import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { request, tokenStore, boardStore, personStore, clientId } from './lib/api.js';
import {
  buildBoard, moscowToday, weekSections, peopleIndex, blockers, filterByMeeting, groupBy,
  shortDate, weekdayDate, daysBetween, pluralTasks, pluralDays, sameName, splitNames,
} from './lib/board.js';

const TABS = [
  { id: 'week', label: 'Неделя' },
  { id: 'people', label: 'Люди' },
  { id: 'links', label: 'Кто кого ждёт' },
  { id: 'decisions', label: 'Решения' },
  { id: 'questions', label: 'Вопросы' },
];

function readRoute() {
  const [tab = 'week', param = ''] = window.location.hash.replace(/^#\/?/, '').split('/');
  return { tab: TABS.some(t => t.id === tab) ? tab : 'week', param: decodeURIComponent(param) };
}

export default function App() {
  const [token, setToken] = useState(() => tokenStore.get());
  const [raw, setRaw] = useState(() => boardStore.get()?.board || null);
  const [savedAt, setSavedAt] = useState(() => boardStore.get()?.savedAt || null);
  const [stale, setStale] = useState(Boolean(boardStore.get()));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [route, setRoute] = useState(readRoute);
  const [meeting, setMeeting] = useState('');
  const [openTask, setOpenTask] = useState(null);

  const accept = useCallback(board => {
    const now = new Date().toISOString();
    setRaw(board); setSavedAt(now); setStale(false); setError('');
    boardStore.set({ board, savedAt: now });
  }, []);

  const logout = useCallback(() => {
    tokenStore.set(null); boardStore.set(null);
    setToken(null); setRaw(null); setSavedAt(null);
  }, []);

  const refresh = useCallback(async () => {
    if (!token?.token) return;
    setLoading(true);
    try {
      const data = await request({ action: 'board', token: token.token });
      accept(data.board);
    } catch (e) {
      if (e.code === 'expired_session') { logout(); setError(e.message); }
      else { setStale(true); setError(e.message); }
    } finally { setLoading(false); }
  }, [token, accept, logout]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    const timer = setInterval(refresh, 120000);
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [refresh]);
  useEffect(() => {
    const onHash = () => { setRoute(readRoute()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const today = moscowToday();
  const full = useMemo(() => (raw ? buildBoard(raw, today) : null), [raw, today]);
  const board = useMemo(() => (full ? filterByMeeting(full, meeting) : null), [full, meeting]);

  if (!token?.token || !full) {
    return <Login error={error} pending={Boolean(token?.token) && loading} onLogin={(data) => {
      const t = { token: data.token, expiresAt: data.expiresAt };
      tokenStore.set(t); setToken(t); accept(data.board);
    }} />;
  }

  const show = task => setOpenTask(full.tasks.find(t => t.id === task.id) || task);

  return (
    <div className="shell">
      <Header loading={loading} onRefresh={refresh} onLogout={logout} />
      <Hero board={full} />
      {(stale || error) && (
        <p className="notice" role="status">
          {error || 'Обновляю…'} {savedAt && <>Показана копия от {new Date(savedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.</>}
        </p>
      )}
      <nav className="tabs" aria-label="Разделы">
        {TABS.map(t => (
          <a key={t.id} href={`#/${t.id}`} className={route.tab === t.id ? 'tab active' : 'tab'} aria-current={route.tab === t.id ? 'page' : undefined}>{t.label}</a>
        ))}
      </nav>
      {full.meetings.length > 1 && (
        <label className="meeting-filter">
          <span>Поставлено на встрече</span>
          <select value={meeting} onChange={e => setMeeting(e.target.value)}>
            <option value="">все встречи</option>
            {full.meetings.map(m => <option key={m} value={m}>{weekdayDate(m)}</option>)}
          </select>
        </label>
      )}
      <main>
        {route.tab === 'week' && <Week board={board} onShow={show} />}
        {route.tab === 'people' && <People board={board} name={route.param} onShow={show} />}
        {route.tab === 'links' && <Links board={board} onShow={show} />}
        {route.tab === 'decisions' && <Decisions board={board} />}
        {route.tab === 'questions' && <Questions board={board} />}
      </main>
      <footer className="footer">
        Данные из таблицы рабочей группы{full.generatedAt ? `, обновлено ${new Date(full.generatedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : ''}. Ошибка или изменение — напишите Андрею.
      </footer>
      <TaskSheet task={openTask} onClose={() => setOpenTask(null)} onShow={show} />
    </div>
  );
}

/* ---------- Вход и шапка ---------- */

function Login({ onLogin, error: outerError, pending }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async e => {
    e.preventDefault();
    if (!password) return;
    setBusy(true); setError('');
    try { onLogin(await request({ action: 'login', password, clientId: clientId() })); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  return (
    <div className="login">
      <div className="wordmark big"><Mark /> ТЕРМА</div>
      <h1>Рабочая группа</h1>
      <p className="lead">Кто что обещал, кто кого ждёт, что решили на встречах.</p>
      {pending ? <p className="muted">Загружаю доску…</p> : (
        <form onSubmit={submit}>
          <label htmlFor="pw">Пароль группы</label>
          <input id="pw" type="password" autoComplete="current-password" value={password}
            onChange={e => setPassword(e.target.value)} autoFocus />
          <button className="primary" disabled={busy || !password}>{busy ? 'Проверяю…' : 'Войти'}</button>
          {(error || outerError) && <p className="error" role="alert">{error || outerError}</p>}
        </form>
      )}
      <p className="muted small">Пароль выдаёт Андрей. Вход сохраняется на этом устройстве на 14 дней.</p>
    </div>
  );
}

function Header({ loading, onRefresh, onLogout }) {
  return (
    <header className="header">
      <a href="#/week" className="wordmark"><Mark /> ТЕРМА <span>рабочая группа</span></a>
      <div className="header-actions">
        <button className="icon" onClick={onRefresh} disabled={loading} aria-label="Обновить">
          <svg viewBox="0 0 24 24" className={loading ? 'spin' : ''}><path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5" /></svg>
        </button>
        <button className="icon" onClick={onLogout} aria-label="Выйти">
          <svg viewBox="0 0 24 24"><path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" /></svg>
        </button>
      </div>
    </header>
  );
}

function Mark() {
  return (
    <svg className="mark" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M5 22c3.6-2.8 7.4-2.8 11 0s7.4 2.8 11 0" /><path d="M11 8v7M16 6v9M21 8v7" />
    </svg>
  );
}

function Hero({ board }) {
  const s = weekSections(board.tasks);
  const until = daysBetween(board.today, board.meetingDay);
  const waiting = board.tasks.filter(t => t.open && t.waitingFor.length).length;
  return (
    <section className="hero">
      <p className="kicker">Ближайшая встреча</p>
      <h1>{weekdayDate(board.meetingDay)}</h1>
      <p className="hero-sub">{until === 0 ? 'сегодня' : until === 1 ? 'завтра' : `через ${pluralDays(until)}`}</p>
      <div className="stats">
        <a href="#/week" className="stat late"><b>{s.late.length}</b><span>просрочено</span></a>
        <a href="#/week" className="stat soon"><b>{s.soon.length}</b><span>к встрече</span></a>
        <a href="#/links" className="stat"><b>{waiting}</b><span>ждут других</span></a>
        <a href="#/week" className="stat done"><b>{s.done.length}</b><span>из {board.tasks.length} закрыто</span></a>
      </div>
    </section>
  );
}

/* ---------- Карточка задачи ---------- */

const STATUS_LABEL = { open: 'Открыт', progress: 'В работе', moved: 'Перенос', done: 'Выполнено', dropped: 'Снято', accepted: 'Принято', draft: 'Предварительно' };

function Pill({ kind, text }) {
  return <span className={`pill ${kind}`}>{text || STATUS_LABEL[kind]}</span>;
}

function dueText(t) {
  if (!t.due) return 'срок не назван';
  if (t.late) return `просрочено на ${pluralDays(t.late)} · срок ${shortDate(t.due)}`;
  return `срок ${weekdayDate(t.due)}`;
}

function TaskCard({ task: t, onShow, compact }) {
  return (
    <article className={`task ${t.open ? '' : 'closed'} ${t.late ? 'is-late' : ''}`}>
      <div className="task-top">
        <span className="num">№{t.num}</span>
        <a className="who" href={`#/people/${encodeURIComponent(t.person)}`}>{t.person}</a>
        {t.role && <span className="role">{t.role}</span>}
        <Pill kind={t.kind} text={t.status} />
      </div>
      <h3>{t.title}</h3>
      <p className={`due ${t.late ? 'late' : t.soon ? 'soon' : ''}`}>{dueText(t)}</p>
      {!compact && t.waitingFor.length > 0 && (
        <div className="deps"><span className="deps-label">Ждёт</span>
          {t.waitingFor.map(d => <DepChip key={d.id} task={d} onShow={onShow} />)}
        </div>
      )}
      {!compact && t.waitedBy.length > 0 && (
        <div className="deps"><span className="deps-label">Её ждут</span>
          {t.waitedBy.map(d => <DepChip key={d.id} task={d} onShow={onShow} />)}
        </div>
      )}
      {!compact && t.comment && <p className="comment">{t.comment}</p>}
    </article>
  );
}

function DepChip({ task: d, onShow }) {
  return (
    <button className={`chip ${d.late ? 'late' : ''}`} onClick={() => onShow(d)}>
      №{d.num} · {d.person}{d.late ? ' · просрочено' : ''}
    </button>
  );
}

function TaskSheet({ task, onClose, onShow }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (task && !dialog.open) dialog.showModal();
    if (!task && dialog.open) dialog.close();
  }, [task]);
  return (
    <dialog ref={ref} className="sheet" onCancel={e => { e.preventDefault(); onClose(); }}
      onClick={e => { if (e.target === ref.current) onClose(); }}>
      {task && (
        <div className="sheet-body">
          <button className="sheet-close" onClick={onClose} aria-label="Закрыть">×</button>
          <TaskCard task={task} onShow={onShow} />
          <p className="muted small">Поставлено на встрече {weekdayDate(task.meeting)}{task.deps ? ` · зависит: ${task.deps}` : ''}</p>
        </div>
      )}
    </dialog>
  );
}

function Section({ title, note, items, onShow, empty }) {
  if (!items.length && !empty) return null;
  return (
    <section className="section">
      <h2>{title} <span className="count">{items.length}</span></h2>
      {note && <p className="section-note">{note}</p>}
      {items.length ? items.map(t => <TaskCard key={t.id} task={t} onShow={onShow} />) : <p className="muted">{empty}</p>}
    </section>
  );
}

/* ---------- Разделы ---------- */

function Week({ board, onShow }) {
  const s = weekSections(board.tasks);
  return (
    <>
      <Section title="Просрочено" items={s.late} onShow={onShow} note="Срок прошёл, статус в таблице не закрыт." />
      <Section title={`К встрече ${shortDate(board.meetingDay)}`} items={s.soon} onShow={onShow} empty="Ничего не назначено." />
      <Section title="Позже" items={s.later} onShow={onShow} />
      <Section title="Срок не назван" items={s.undated} onShow={onShow} note="Срок нужно назначить на ближайшей встрече." />
      {s.done.length > 0 && (
        <details className="section done-block">
          <summary><h2>Закрыто <span className="count">{s.done.length}</span></h2></summary>
          {s.done.map(t => <TaskCard key={t.id} task={t} onShow={onShow} compact />)}
        </details>
      )}
    </>
  );
}

function People({ board, name, onShow }) {
  const people = peopleIndex(board);
  const [mine, setMine] = useState(() => personStore.get());
  if (name) {
    const p = people.find(x => x.name === name);
    if (!p) return <p className="muted">Нет задач у «{name}» в выбранном периоде. <a href="#/people">Все люди</a></p>;
    const open = p.tasks.filter(t => t.open).sort((a, b) => (b.late - a.late) || (a.due || '9').localeCompare(b.due || '9'));
    const waitsFor = [...new Set(open.flatMap(t => t.waitingFor))].filter(d => d.person !== p.name);
    const waitedBy = [...new Set(open.flatMap(t => t.waitedBy))].filter(w => w.person !== p.name);
    const isMine = mine === p.name;
    return (
      <>
        <div className="person-head">
          <a href="#/people" className="back">← Все люди</a>
          <h2 className="person-name">{p.name}</h2>
          <p className="muted">{[p.role || p.side, p.area].filter(Boolean).join(' · ')}</p>
          <button className={`ghost ${isMine ? 'on' : ''}`} onClick={() => { const v = isMine ? null : p.name; personStore.set(v); setMine(v); }}>
            {isMine ? 'Это я ✓' : 'Это я — открывать первым'}
          </button>
        </div>
        <Section title="Обещания" items={open} onShow={onShow} empty="Открытых задач нет." />
        <Section title="Нужно от других" items={waitsFor} onShow={onShow} note="Без этих задач свои не закрыть." />
        <Section title="Ждут результата" items={waitedBy} onShow={onShow} note="Эти задачи других стоят, пока не закрыты свои." />
        {p.questions.length > 0 && (
          <section className="section"><h2>Ведёт вопросы <span className="count">{p.questions.length}</span></h2>
            {p.questions.map(q => <QuestionCard key={q.row} q={q} />)}
          </section>
        )}
        {p.tasks.some(t => !t.open) && (
          <details className="section done-block">
            <summary><h2>Закрыто <span className="count">{p.tasks.filter(t => !t.open).length}</span></h2></summary>
            {p.tasks.filter(t => !t.open).map(t => <TaskCard key={t.id} task={t} onShow={onShow} compact />)}
          </details>
        )}
      </>
    );
  }
  const sorted = mine ? [...people].sort((a, b) => (sameName(b.name, mine) ? 1 : 0) - (sameName(a.name, mine) ? 1 : 0)) : people;
  return (
    <ul className="people">
      {sorted.map(p => (
        <li key={p.name}>
          <a href={`#/people/${encodeURIComponent(p.name)}`}>
            <span className="p-name">{p.name}{mine === p.name && <em> · я</em>}</span>
            <span className="p-role">{p.role || p.side}</span>
            <span className="p-stats">
              {p.late > 0 && <span className="badge late">{p.late} просроч.</span>}
              <span className="badge">{p.open} откр.</span>
              {p.blocking > 0 && <span className="badge wait">ждут {p.blocking}</span>}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

function Links({ board, onShow }) {
  const list = blockers(board);
  if (!list.length) return <p className="muted section">Сейчас никто никого не держит: у открытых задач нет незакрытых зависимостей.</p>;
  return (
    <>
      <p className="section-note">Чьи открытые задачи держат работу других. Сверху — те, кого ждут больше всего.</p>
      {list.map(b => (
        <section key={b.person} className="section chain">
          <h2><a href={`#/people/${encodeURIComponent(b.person)}`}>{b.person}</a> <span className="count">держит {pluralTasks(b.waiting)}</span></h2>
          {b.tasks.map(t => (
            <div key={t.id} className="chain-row">
              <TaskCard task={t} onShow={onShow} compact />
              <div className="arrow" aria-hidden="true">↓ ждут</div>
              <div className="chain-waiters">
                {t.waitedBy.map(w => (
                  <button key={w.id} className="waiter" onClick={() => onShow(w)}>
                    <b>№{w.num} {w.person}</b><span>{w.title}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </section>
      ))}
    </>
  );
}

function Decisions({ board }) {
  if (!board.decisions.length) return <p className="muted section">Решений пока нет.</p>;
  return groupBy(board.decisions, 'topic').map(([topic, items]) => (
    <section key={topic} className="section">
      <h2>{topic} <span className="count">{items.length}</span></h2>
      {items.map(d => (
        <article key={d.row} className="decision">
          <p className="decision-text">{d.text}</p>
          <p className="meta">
            <Pill kind={d.kind} text={d.status} />
            {d.by && <span>{d.by}</span>}
            {d.meeting && <span>{shortDate(d.meeting)}</span>}
          </p>
          {d.comment && <p className="comment">{d.comment}</p>}
        </article>
      ))}
    </section>
  ));
}

function QuestionCard({ q }) {
  return (
    <article className={`question ${q.open ? '' : 'closed'}`}>
      <p className="meta">{q.topic && <span className="topic">{q.topic}</span>}<Pill kind={q.kind} text={q.status} /></p>
      <h3>{q.text}</h3>
      {q.missing && <p><span className="label">Не хватает:</span> {q.missing}</p>}
      <p className="meta">
        {q.owner && <span>Ведёт: {splitNames(q.owner).join(', ')}</span>}
        {q.target && <span>к встрече {shortDate(q.target)}</span>}
      </p>
    </article>
  );
}

function Questions({ board }) {
  const open = board.questions.filter(q => q.open);
  const closed = board.questions.filter(q => !q.open);
  return (
    <>
      <section className="section">
        <h2>Открытые <span className="count">{open.length}</span></h2>
        {open.length ? open.map(q => <QuestionCard key={q.row} q={q} />) : <p className="muted">Открытых вопросов нет.</p>}
      </section>
      {closed.length > 0 && (
        <details className="section done-block">
          <summary><h2>Решённые <span className="count">{closed.length}</span></h2></summary>
          {closed.map(q => <QuestionCard key={q.row} q={q} />)}
        </details>
      )}
    </>
  );
}
