// ============================================================
// roles.js — Rol tanımları ve sabitler
// ============================================================

const TEAM = {
  IYILER: 'IYILER',
  SUIKASTCILAR: 'SUIKASTCILAR',
  TARAFSIZ: 'TARAFSIZ',
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
};

// 8 kişilik sabit dağıtım. İstersen ileride oyuncu sayısına göre
// dinamik bir tablo hâline getirilebilir (örn. 6-12 kişi desteği).
const ROLE_DEFINITIONS = {
  [ROLE.GIZLI_PRENSES]: {
    team: TEAM.IYILER,
    label: 'Gizli Prenses Gubiş',
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
    label: 'Baş Casus',
    description: 'Her gece 1 kişinin "Tehlikeli" ya da "Masum" olduğunu öğrenir.',
    nightAction: true,
    abilityKey: 'SPY_INVESTIGATE',
    usesPerGame: Infinity,
  },
  [ROLE.GOLGE_LIDER]: {
    team: TEAM.SUIKASTCILAR,
    label: 'Gölge Lider',
    description: 'Suikast hedefini belirler. Oyun boyu 1 kez birinin Gubiş olup olmadığını sorgulayabilir.',
    nightAction: true,
    abilityKey: 'ASSASSIN_CHOOSE_TARGET',
    oneTimePower: 'QUERY_IS_PRINCESS',
  },
  [ROLE.ZEHIRBAZ]: {
    team: TEAM.SUIKASTCILAR,
    label: 'Zehirbaz',
    description: 'Oyun boyu 1 kez bir oyuncunun gece yeteneğini kilitler (etkisiz kılar).',
    nightAction: true,
    abilityKey: 'POISONER_LOCK_ABILITY',
    usesPerGame: 1,
  },
  [ROLE.TAHT_TALIPLISI]: {
    team: TEAM.TARAFSIZ,
    label: 'Taht Taliplisi',
    description: 'Gubiş elenir ve kendisi oyun sonuna kadar hayatta kalırsa tek başına kazanır.',
    nightAction: false,
  },
};

// Oda boyutuna göre rol seti. Denge mantığı: suikastçı oranı her boyutta
// kabaca 1/3'ün altında tutulur, oyun küçüldükçe en "ek/lüks" roller
// (Hekim, Taht Taliplisi) önce çıkarılır çünkü çekirdek mekanik (Gubiş,
// Muhafız, Casus, Gölge Lider) onlarsız da tam çalışır.
const ROLE_SETS_BY_SIZE = {
  4: [ROLE.GIZLI_PRENSES, ROLE.MUHAFIZ, ROLE.BAS_CASUS, ROLE.GOLGE_LIDER],
  6: [
    ROLE.GIZLI_PRENSES,
    ROLE.SAHTE_PRENSES,
    ROLE.MUHAFIZ,
    ROLE.BAS_CASUS,
    ROLE.GOLGE_LIDER,
    ROLE.ZEHIRBAZ,
  ],
  8: Object.keys(ROLE_DEFINITIONS),
};

const SUPPORTED_ROOM_SIZES = Object.keys(ROLE_SETS_BY_SIZE).map(Number);

// Rastgele rol dağıtımı (Fisher-Yates shuffle). roomSize: 4, 6 veya 8.
function assignRoles(players, roomSize = 8) {
  const roleSet = ROLE_SETS_BY_SIZE[roomSize];
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

module.exports = { TEAM, ROLE, ROLE_DEFINITIONS, ROLE_SETS_BY_SIZE, SUPPORTED_ROOM_SIZES, assignRoles };
