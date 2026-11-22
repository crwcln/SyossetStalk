// Thin API client. No sockets: every call is a short POST, so a slept tab resumes cleanly.
const KEY = 'stoss.session';

export function loadSession() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || !s.code || !s.pid || !s.token) return null;
    return s;
  } catch {
    return null;
  }
}

export function saveSession(s) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode */
  }
}

async function post(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
    cache: 'no-store',
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export function createApi(session) {
  const s = session || {};
  return {
    session: s,
    create: (name) => post('/api/create', { name }),
    join: (code, name) => post('/api/join', { code, name }),
    poll: (input, since) => post('/api/poll', {
      code: s.code, pid: s.pid, token: s.token, input, since,
    }),
    start: () => post('/api/start', { code: s.code, pid: s.pid, token: s.token }),
    addBot: () => post('/api/bot', { code: s.code, pid: s.pid, token: s.token }),
    removeBot: (id) => post('/api/bot', { code: s.code, pid: s.pid, token: s.token, remove: id }),
    remove: (id) => post('/api/remove', { code: s.code, pid: s.pid, token: s.token, target: id }),
    confirm: (digits) => post('/api/confirm', { code: s.code, pid: s.pid, token: s.token, digits }),
    use: (kind) => post('/api/use', { code: s.code, pid: s.pid, token: s.token, kind }),
    leave: () => post('/api/leave', { code: s.code, pid: s.pid, token: s.token }),
    rematch: () => post('/api/rematch', { code: s.code, pid: s.pid, token: s.token }),
  };
}
