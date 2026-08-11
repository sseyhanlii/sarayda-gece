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

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

// ---------- Profil ----------
export function fetchMyProfile(token) {
  return request('/api/profile/me', { headers: authHeader(token) });
}

export function updateMyProfile(token, { username, avatarEmoji }) {
  return request('/api/profile/me', {
    method: 'PATCH',
    headers: authHeader(token),
    body: JSON.stringify({ username, avatarEmoji }),
  });
}

export function fetchAvailableAvatars() {
  return request('/api/profile/avatars');
}

export function changePassword(token, currentPassword, newPassword) {
  return request('/api/auth/change-password', {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

// ---------- Admin ----------
export function fetchAdminUsers(token) {
  return request('/api/admin/users', { headers: authHeader(token) });
}

export function setUserBanned(token, userId, banned) {
  return request(`/api/admin/users/${userId}/ban`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ banned }),
  });
}

export function fetchAdminRooms(token) {
  return request('/api/admin/rooms', { headers: authHeader(token) });
}

export function endRoomAsAdmin(token, roomCode) {
  return request(`/api/admin/rooms/${roomCode}/end`, {
    method: 'POST',
    headers: authHeader(token),
  });
}
