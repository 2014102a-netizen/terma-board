export class ApiError extends Error {
  constructor(message, code = 'network') { super(message); this.code = code; }
}

const messages = {
  bad_password: 'Пароль не подошёл. Проверьте раскладку и попробуйте снова.',
  expired_session: 'Войдите ещё раз: срок входа истёк или пароль сменился.',
  not_configured: 'Вход ещё не настроен. Напишите Андрею.',
  rate_limit: 'Слишком много попыток. Подождите 10 минут.',
};

export async function request(body) {
  const api = window.TERMA_API;
  if (!api) throw new ApiError('Доска ещё не подключена к таблице.', 'not_configured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    // text/plain — без предварительного запроса CORS, так Apps Script принимает POST со страницы.
    const response = await fetch(api, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body), signal: controller.signal, redirect: 'follow',
    });
    if (!response.ok) throw new Error('http');
    const data = await response.json();
    if (!data.ok) throw new ApiError(messages[data.error] || 'Не получилось загрузить. Попробуйте ещё раз.', data.error);
    return data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('Нет связи с таблицей. Проверьте интернет и обновите.');
  } finally { clearTimeout(timer); }
}

function store(key) {
  return {
    get() { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
    set(value) {
      try { value == null ? localStorage.removeItem(key) : localStorage.setItem(key, JSON.stringify(value)); } catch { /* приватный режим */ }
    },
  };
}

export const tokenStore = store('terma-token');
export const boardStore = store('terma-board');
export const personStore = store('terma-person');

export function clientId() {
  const s = store('terma-client');
  let id = s.get();
  if (!id) { id = Math.random().toString(36).slice(2) + Date.now().toString(36); s.set(id); }
  return id;
}
