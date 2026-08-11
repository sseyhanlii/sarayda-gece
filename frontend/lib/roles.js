// ============================================================
// roles.js — Rollerin Türkçe etiketleri (backend/game/roles.js ile birebir eşleşir)
// Frontend ve backend ayrı deploy edildiği için kod paylaşımı yerine
// bilinçli olarak burada tekrar tanımlanmıştır.
// ============================================================

export const ROLE_LABELS = {
  GIZLI_PRENSES: 'Gizli Prenses',
  SAHTE_PRENSES: 'Sahte Prenses / Dublör',
  MUHAFIZ: 'Kraliyet Muhafızı',
  HEKIM: 'Saray Hekimi',
  BAS_CASUS: 'Baş Casus',
  GOLGE_LIDER: 'Gölge Lider',
  ZEHIRBAZ: 'Zehirbaz',
  TAHT_TALIPLISI: 'Taht Taliplisi',
};

export const ROLE_DESCRIPTIONS = {
  GIZLI_PRENSES: 'Kimliğin gizli. Gündüz idam edilmek üzereyken 1 kez kartını açıp idamı iptal ettirebilirsin.',
  SAHTE_PRENSES: 'Sen bir yemsin. Suikastçılar seni öldürürse bir sonraki gece saldıramazlar.',
  MUHAFIZ: 'Her gece 1 kişiyi suikasttan koruyabilirsin.',
  HEKIM: 'Oyun boyu 1 panzehir ve 1 zehir hakkın var.',
  BAS_CASUS: 'Her gece 1 kişinin Tehlikeli mi Masum mu olduğunu öğrenebilirsin.',
  GOLGE_LIDER: 'Suikast hedefini sen belirlersin. Oyun boyu 1 kez birinin Prenses olup olmadığını sorgulayabilirsin.',
  ZEHIRBAZ: 'Oyun boyu 1 kez bir rolün gece yeteneğini kilitleyebilirsin.',
  TAHT_TALIPLISI: 'Prenses elenir ve sen oyun sonuna kadar hayatta kalırsan tek başına kazanırsın.',
};

export const TEAM_LABELS = {
  IYILER: 'İyiler',
  SUIKASTCILAR: 'Suikastçılar',
  TARAFSIZ: 'Tarafsız',
};

export const ALL_ROLE_KEYS = Object.keys(ROLE_LABELS);

// backend/game/roles.js -> ROLE_SETS_BY_SIZE ile birebir eşleşir.
// Lobide oda boyutu seçilirken hangi rollerin oyunda olacağını göstermek için kullanılır.
export const ROOM_SIZE_ROLE_SETS = {
  4: ['GIZLI_PRENSES', 'MUHAFIZ', 'BAS_CASUS', 'GOLGE_LIDER'],
  6: ['GIZLI_PRENSES', 'SAHTE_PRENSES', 'MUHAFIZ', 'BAS_CASUS', 'GOLGE_LIDER', 'ZEHIRBAZ'],
  8: ALL_ROLE_KEYS,
};

export const ROOM_SIZES = [4, 6, 8];

// backend/server.js -> AVAILABLE_AVATAR_EMOJIS ile birebir eşleşir (yedek/varsayılan liste;
// gerçek liste /api/profile/avatars'tan da çekilebilir).
export const DEFAULT_AVATAR_EMOJIS = ['👑', '🗡️', '🛡️', '🔮', '🕯️', '🦉', '🐺', '🌙', '⚜️', '🎭'];
