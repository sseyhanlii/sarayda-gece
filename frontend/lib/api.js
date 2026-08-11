// ============================================================
// api.js — Backend REST çağrıları (auth, istatistik, liderlik tablosu)
// ============================================================

const BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:4000';

async function request(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `İstek başarısız (HTTP ${res.status})`);
  }
  return data;
}

export function register(username, email, password) {
  return request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, email, password }),
  });
}

export function login(email, password) {
  return request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export function fetchLeaderboard() {
  return request('/api/leaderboard');
}

export function fetchMyStats(token) {
  return request('/api/stats/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
}
