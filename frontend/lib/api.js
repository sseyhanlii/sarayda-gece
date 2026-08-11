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

// Kullanıcının kendi yüklediği fotoğraf — admin onaylayana kadar canlı olmaz.
export function uploadAvatarPhoto(token, imageDataUrl) {
  return request('/api/profile/avatar', {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ imageDataUrl }),
  });
}

// Herkesin görebildiği, rol bazlı en çok kazananlar sıralaması.
export function fetchRoleLeaderboard() {
  return request('/api/leaderboard/by-role');
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

export function setProfileLock(token, userId, locked) {
  return request(`/api/admin/users/${userId}/profile-lock`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ locked }),
  });
}

// SADECE owner (baş yönetici) çağırabilir — sunucu tarafında da doğrulanır.
export function promoteToAdmin(token, userId, isAdmin) {
  return request(`/api/admin/users/${userId}/promote`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ isAdmin }),
  });
}

export function deleteUserAccount(token, userId) {
  return request(`/api/admin/users/${userId}`, {
    method: 'DELETE',
    headers: authHeader(token),
  });
}

export function fetchPendingAvatars(token) {
  return request('/api/admin/avatars/pending', { headers: authHeader(token) });
}

export function reviewAvatar(token, userId, approve) {
  return request(`/api/admin/avatars/${userId}/review`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ approve }),
  });
}

// ---------- Sesli sohbet (Agora token) ----------
export function fetchVoiceToken(token, channelName) {
  return request(`/api/voice/token?channelName=${encodeURIComponent(channelName)}`, {
    headers: authHeader(token),
  });
}

// ---------- Oyun ayarları (gece/gündüz/oylama süresi, oda isimleri, rol dağılımları) ----------
// Herkese açık — oturum gerektirmez, lobi ve oda sayfaları buradan güncel
// değerleri çeker (owner ayarı değiştirdiği anda yeni deploy gerekmeden yansır).
export function fetchPublicSettings() {
  return request('/api/settings/public');
}

export function fetchAdminSettings(token) {
  return request('/api/admin/settings', { headers: authHeader(token) });
}

export function updateAdminSettings(token, settings) {
  return request('/api/admin/settings', {
    method: 'PUT',
    headers: authHeader(token),
    body: JSON.stringify(settings),
  });
}

// SADECE owner: bir admin'in izinlerini tek tek açar/kapatır.
export function updateAdminPermissions(token, userId, permissions) {
  return request(`/api/admin/users/${userId}/permissions`, {
    method: 'PATCH',
    headers: authHeader(token),
    body: JSON.stringify({ permissions }),
  });
}

// Yönetici tek tuşla odaya bot ekler.
export function addBotToRoom(token, roomCode) {
  return request(`/api/admin/rooms/${roomCode}/add-bot`, {
    method: 'POST',
    headers: authHeader(token),
  });
}
