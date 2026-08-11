// ============================================================
// auth.js — JWT token'ı ve kullanıcı bilgisini tarayıcıda saklama
// Not: Bu gerçek bir web uygulaması (Vercel'de barındırılan Next.js),
// Claude "artifact" önizlemesi değil — bu ortamda localStorage kullanmak
// standart ve güvenli bir pratiktir.
// ============================================================

const TOKEN_KEY = 'sarayda-gece-token';
const USER_KEY = 'sarayda-gece-user';

export function saveSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function getToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function getUser() {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function isLoggedIn() {
  return Boolean(getToken());
}
