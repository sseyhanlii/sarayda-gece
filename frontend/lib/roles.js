// ============================================================
// roles.js — Rollerin Türkçe etiketleri (backend/game/roles.js ile birebir eşleşir)
// Frontend ve backend ayrı deploy edildiği için kod paylaşımı yerine
// bilinçli olarak burada tekrar tanımlanmıştır.
// ============================================================

export const ROLE_LABELS = {
  GIZLI_PRENSES: 'Prenses Gubiş',
  SAHTE_PRENSES: 'Sahte Prenses / Dublör',
  MUHAFIZ: 'Kraliyet Muhafızı',
  HEKIM: 'Saray Hekimi',
  BAS_CASUS: 'Baş Gözcü',
  GOLGE_LIDER: 'Gölge Lider',
  ZEHIRBAZ: 'Zehirbaz',
  TAHT_TALIPLISI: 'Taht Taliplisi',
  ASKO: 'Aşko',
};

export const ROLE_DESCRIPTIONS = {
  GIZLI_PRENSES: 'Kimliğin gizli. Gündüz idam edilmek üzereyken 1 kez kartını açıp idamı iptal ettirebilirsin.',
  SAHTE_PRENSES: 'Sen bir yemsin. Suikastçılar seni öldürürse bir sonraki gece saldıramazlar.',
  MUHAFIZ: 'Her gece 1 kişiyi suikasttan koruyabilirsin.',
  HEKIM: 'Oyun boyu 1 panzehir ve 1 zehir hakkın var.',
  BAS_CASUS: 'Her gece 1 kişinin Tehlikeli mi Masum mu olduğunu öğrenebilirsin.',
  GOLGE_LIDER: 'Vampir takımınla (Zehirbaz varsa o dahil) birlikte gece suikast hedefini oylarsın. Oyun boyu 1 kez birinin Gubiş olup olmadığını sorgulayabilirsin.',
  ZEHIRBAZ: 'Vampir takımınla birlikte gece suikast hedefini oylarsın. Oyun boyu 1 kez bir rolün gece yeteneğini kilitleyebilirsin.',
  TAHT_TALIPLISI: 'Gubiş elenir ve sen oyun sonuna kadar hayatta kalırsan tek başına kazanırsın.',
  ASKO: 'Oyunun ilk gecesinde iki oyuncuyu birbirine aşık edersin. Aşıklar artık kendi takımlarıyla kazanamaz — sadece ikisi birlikte son ikiye kalırsa kazanırlar. Biri ölürse diğeri de kalbi kırılarak ölür.',
};

export const TEAM_LABELS = {
  IYILER: 'İyiler',
  SUIKASTCILAR: 'Suikastçılar',
  TARAFSIZ: 'Tarafsız',
  ASIKLAR: 'Aşıklar',
};

export const ALL_ROLE_KEYS = Object.keys(ROLE_LABELS);

// Owner admin panelinden rollerin görünen ismini değiştirebiliyor
// (bkz. GET/PUT /api/settings/public ve /api/admin/settings -> roleLabels).
// Bu, varsayılan ROLE_LABELS'ın üzerine SADECE gönderilen anahtarları yazan
// bir "efektif etiket haritası" üretir — böylece owner bazı rolleri
// değiştirip bazılarını varsayılanda bırakabilir. Sunucuya erişilemezse
// (overrides boş/undefined) saf ROLE_LABELS ile aynı sonucu döner.
export function resolveRoleLabels(overrides) {
  if (!overrides || typeof overrides !== 'object') return ROLE_LABELS;
  const merged = { ...ROLE_LABELS };
  for (const [key, label] of Object.entries(overrides)) {
    if (typeof label === 'string' && label.trim() && merged[key] !== undefined) {
      merged[key] = label;
    }
  }
  return merged;
}

// Gece bir eylemi olan roller — Zehirbaz'ın "kilitle" listesi ve benzeri
// yerlerde SADECE bunlar gösterilir (bir rolün gece yeteneği yoksa kilitlemek
// anlamsızdır).
export const NIGHT_ACTION_ROLES = ['MUHAFIZ', 'HEKIM', 'BAS_CASUS', 'GOLGE_LIDER', 'ZEHIRBAZ', 'ASKO'];

// Vampir (suikastçı) takımının üyesi olabilen roller — gece birlikte hedef oylar.
export const ASSASSIN_TEAM_ROLES = ['GOLGE_LIDER', 'ZEHIRBAZ'];

// backend/game/roles.js -> ROLE_SETS_BY_SIZE ile birebir eşleşir. Sadece hiç
// yönetici ayarı yüklenemediğinde (örn. backend'e erişilemiyorsa) YEDEK olarak
// kullanılır — asıl güncel değerler /api/settings/public'ten çekilir (bkz.
// fetchPublicSettings, lobby ve room sayfalarında).
export const ROOM_SIZE_ROLE_SETS = {
  4: ['GIZLI_PRENSES', 'MUHAFIZ', 'BAS_CASUS', 'GOLGE_LIDER'],
  6: ['GIZLI_PRENSES', 'ASKO', 'MUHAFIZ', 'BAS_CASUS', 'GOLGE_LIDER', 'ZEHIRBAZ'],
  8: ['GIZLI_PRENSES', 'ASKO', 'MUHAFIZ', 'HEKIM', 'BAS_CASUS', 'GOLGE_LIDER', 'ZEHIRBAZ', 'TAHT_TALIPLISI'],
};

export const ROOM_SIZES = [4, 6, 8];

// Oda boyutuna göre özel oda adları — YEDEK değerler, asıl güncel isimler
// admin panelinden değiştirilip /api/settings/public'ten çekilir.
export const ROOM_SIZE_NAMES = {
  4: 'Fenerlikız Odası',
  6: 'Pizza Odası',
  8: 'Zeygen Odası',
};

// Her oyuncuya sabit, birbirinden ayrışan bir renk atamak için palet.
// Sırayla değil, userId'den türetilen bir hash ile seçiliyor (bkz. getPlayerColor) —
// böylece bir oyuncu odadan çıkıp girse ya da oyuncu listesi yeniden sıralansa
// bile hep AYNI rengi alır.
export const PLAYER_COLORS = [
  '#ff5fa2', '#3fae7a', '#4c8bff', '#e8a83c',
  '#9a4cff', '#ff7a3d', '#2fb6c4', '#d1439a',
];

export function getPlayerColor(userId) {
  const str = String(userId ?? '');
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return PLAYER_COLORS[hash % PLAYER_COLORS.length];
}

// backend/server.js -> AVAILABLE_AVATAR_EMOJIS ile birebir eşleşir (yedek/varsayılan liste;
// gerçek liste /api/profile/avatars'tan da çekilebilir).
export const DEFAULT_AVATAR_EMOJIS = ['👑', '🗡️', '🛡️', '🔮', '🕯️', '🦉', '🐺', '🌙', '⚜️', '🎭'];

// Yönetici izin sistemi: owner her admin için bunları tek tek açıp kapatabilir
// (bkz. admin panelindeki "Kullanıcılar" sekmesi). backend'deki ADMIN_PERMISSIONS
// ile birebir eşleşir.
export const ADMIN_PERMISSION_LABELS = {
  manage_users: 'Kullanıcı Yönetimi (yasakla / ad-fotoğraf kilitle)',
  delete_users: 'Hesap Silme',
  manage_rooms: 'Oda Yönetimi (sonlandır, gizlice izle, bot ekle)',
  review_avatars: 'Fotoğraf Onayı',
  edit_settings: 'Oyun Ayarlarını Düzenleme',
};
