// ============================================================
// roles.js — Rol tanımları ve sabitler
// ============================================================

const TEAM = {
  IYILER: 'IYILER',
  SUIKASTCILAR: 'SUIKASTCILAR',
  TARAFSIZ: 'TARAFSIZ',
  ASIKLAR: 'ASIKLAR', // Aşko'nun eşleştirdiği iki oyuncu — sadece birlikte kazanırlar
};

const ROLE = {
  GIZLI_PRENSES: 'GIZLI_PRENSES',
  SAHTE_PRENSES: 'SAHTE_PRENSES',
  MUHAFIZ: 'MUHAFIZ',
  HEKIM: 'HEKIM',
  BAS_CASUS: 'BAS_CASUS',
  GOLGE_LIDER: 'GOLGE_LIDER',
  ZEHIRBAZ: 'ZEHIRBAZ',
  TAHT_TALIPLISI: 'TAHT_TALIPLISI',
  ASKO: 'ASKO',
};

// Not: ROLE_DEFINITIONS içindeki dahili anahtarlar (GIZLI_PRENSES, BAS_CASUS vb.)
// geçmiş maç kayıtlarıyla uyumluluk için değiştirilmedi — sadece görünen
// Türkçe etiketler (label) güncellendi ("Gizli Prenses Gubiş" -> "Prenses Gubiş",
// "Baş Casus" -> "Baş Gözcü").
const ROLE_DEFINITIONS = {
  [ROLE.GIZLI_PRENSES]: {
    team: TEAM.IYILER,
    label: 'Prenses Gubiş',
    description: 'Kimliği gizli. Gündüz idam edilecekken 1 kez kart açıp iptal ettirebilir.',
    nightAction: false,
    oneTimePower: 'REVEAL_CANCEL_EXECUTION',
  },
  [ROLE.SAHTE_PRENSES]: {
    team: TEAM.IYILER,
    label: 'Sahte Prenses / Dublör',
    description: 'Yemdir. Suikastçılar onu öldürürse bir sonraki gece saldıramazlar.',
    nightAction: false,
  },
  [ROLE.MUHAFIZ]: {
    team: TEAM.IYILER,
    label: 'Kraliyet Muhafızı',
    description: 'Her gece 1 kişiyi suikasttan korur.',
    nightAction: true,
    abilityKey: 'GUARD_PROTECT',
    usesPerGame: Infinity,
  },
  [ROLE.HEKIM]: {
    team: TEAM.IYILER,
    label: 'Saray Hekimi',
    description: 'Oyun boyunca 1 panzehir (canlandır/koru) ve 1 zehir (öldür) kullanabilir.',
    nightAction: true,
    abilityKey: 'DOCTOR_ANTIDOTE_OR_POISON',
    usesPerGame: { antidote: 1, poison: 1 },
  },
  [ROLE.BAS_CASUS]: {
    team: TEAM.IYILER,
    label: 'Baş Gözcü',
    description: 'Her gece 1 kişinin "Tehlikeli" ya da "Masum" olduğunu öğrenir.',
    nightAction: true,
    abilityKey: 'SPY_INVESTIGATE',
    usesPerGame: Infinity,
  },
  [ROLE.GOLGE_LIDER]: {
    team: TEAM.SUIKASTCILAR,
    label: 'Gölge Lider',
    description: 'Vampir takımıyla birlikte gece suikast hedefini oylar. Oyun boyu 1 kez birinin Gubiş olup olmadığını sorgulayabilir.',
    nightAction: true,
    abilityKey: 'ASSASSIN_CHOOSE_TARGET',
    oneTimePower: 'QUERY_IS_PRINCESS',
  },
  [ROLE.ZEHIRBAZ]: {
    team: TEAM.SUIKASTCILAR,
    label: 'Zehirbaz',
    description: 'Vampir takımıyla birlikte gece suikast hedefini oylar. Oyun boyu 1 kez bir rolün gece yeteneğini kilitler.',
    nightAction: true,
    abilityKey: 'ASSASSIN_CHOOSE_TARGET',
    oneTimePower: 'POISONER_LOCK_ABILITY',
    usesPerGame: 1,
  },
  [ROLE.TAHT_TALIPLISI]: {
    team: TEAM.TARAFSIZ,
    label: 'Taht Taliplisi',
    description: 'Gubiş elenir ve kendisi oyun sonuna kadar hayatta kalırsa tek başına kazanır.',
    nightAction: false,
  },
  [ROLE.ASKO]: {
    team: TEAM.TARAFSIZ,
    label: 'Aşko',
    description:
      'Oyunun ilk gecesinde iki oyuncuyu birbirine aşık eder. Aşıklar artık kendi takımlarıyla kazanamaz — ' +
      'sadece ikisi birlikte son ikiye kalırsa "Aşıklar" olarak kazanırlar. Biri ölürse diğeri de kalbi kırılarak ölür.',
    nightAction: true,
    abilityKey: 'CUPID_MATCH_LOVERS',
    usesPerGame: 1,
  },
};

// Vampirler (suikastçı takımı) — "vampirler birbirini tanısın gece" ve gece
// suikast hedefi oylamasına birlikte katılabilen roller.
const ASSASSIN_TEAM_ROLES = [ROLE.GOLGE_LIDER, ROLE.ZEHIRBAZ];

// Oda boyutuna göre VARSAYILAN rol seti. Yönetici paneli üzerinden owner/admin
// bunu istediği zaman değiştirebilir (bkz. server.js /api/admin/settings) —
// buradaki değerler sadece hiç ayar kaydedilmemişse kullanılan ilk varsayılandır.
const ROLE_SETS_BY_SIZE = {
  4: [ROLE.GIZLI_PRENSES, ROLE.MUHAFIZ, ROLE.BAS_CASUS, ROLE.GOLGE_LIDER],
  6: [ROLE.GIZLI_PRENSES, ROLE.SAHTE_PRENSES, ROLE.MUHAFIZ, ROLE.BAS_CASUS, ROLE.GOLGE_LIDER, ROLE.ZEHIRBAZ],
  8: [
    ROLE.GIZLI_PRENSES,
    ROLE.SAHTE_PRENSES,
    ROLE.MUHAFIZ,
    ROLE.HEKIM,
    ROLE.BAS_CASUS,
    ROLE.GOLGE_LIDER,
    ROLE.ZEHIRBAZ,
    ROLE.TAHT_TALIPLISI,
  ],
};

const SUPPORTED_ROOM_SIZES = Object.keys(ROLE_SETS_BY_SIZE).map(Number);
const ALL_ROLE_KEYS = Object.keys(ROLE_DEFINITIONS);

// Rastgele rol dağıtımı (Fisher-Yates shuffle). roomSize: 4, 6 veya 8.
// customRoleSet verilirse (yönetici panelinden gelen canlı ayar) o kullanılır,
// verilmezse ROLE_SETS_BY_SIZE'daki varsayılana düşer. customRoleSet'in
// uzunluğu roomSize'a eşit olmalı — değilse (bozuk/eski bir ayar) varsayılana
// güvenle geri düşülür.
function assignRoles(players, roomSize = 8, customRoleSet = null) {
  const roleSet =
    Array.isArray(customRoleSet) && customRoleSet.length === roomSize ? customRoleSet : ROLE_SETS_BY_SIZE[roomSize];
  if (!roleSet) {
    throw new Error(`Desteklenmeyen oda boyutu: ${roomSize}. Desteklenenler: ${SUPPORTED_ROOM_SIZES.join(', ')}`);
  }
  if (players.length !== roomSize) {
    throw new Error(`Bu rol seti ${roomSize} oyuncu için tasarlandı.`);
  }
  const shuffled = [...roleSet];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return players.map((player, idx) => ({
    ...player,
    role: shuffled[idx],
    team: ROLE_DEFINITIONS[shuffled[idx]].team,
    isAlive: true,
  }));
}

module.exports = {
  TEAM,
  ROLE,
  ROLE_DEFINITIONS,
  ROLE_SETS_BY_SIZE,
  SUPPORTED_ROOM_SIZES,
  ALL_ROLE_KEYS,
  ASSASSIN_TEAM_ROLES,
  assignRoles,
};
