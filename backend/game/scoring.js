// ============================================================
// scoring.js — Maç sonu puanlama algoritması
// Detaylı açıklama: docs/MIMARI-PLAN.md içindeki "Puanlama Sistemi" bölümü.
// ============================================================

const { ROLE, TEAM } = require('./roles');

const BASE_POINTS = {
  TEAM_WIN: 20,        // takım (İyiler ya da Suikastçılar) olarak kazanmanın taban puanı
  SOLO_WIN: 50,        // Taht Taliplisi tek başına kazanırsa
  SURVIVAL_BONUS: 3,   // maç sonunda hayatta kalan her oyuncuya ek puan
  PRINCESS_SURVIVED_BONUS: 10, // Gizli Prenses hayatta kalıp İyiler kazandıysa ek puan
  DECOY_SACRIFICE_BONUS: 8,    // Sahte Prenses görevini yaparak öldüyse (yem oldu) ek puan
  EARLY_DEATH_PENALTY: -2,     // 1. gecede/günde ölen oyuncuya küçük bir teselli puanı düşüşü yok,
                                // bunun yerine katılım puanı (aşağıda) tek başına verilir
  PARTICIPATION: 2,    // her maça katılım için taban puan (kazanan/kaybeden herkese)
};

// Rol bazlı çarpanlar: bazı roller daha riskli/zor olduğu için hafif ağırlıklandırılır.
const ROLE_MULTIPLIER = {
  [ROLE.GIZLI_PRENSES]: 1.3,   // en kritik rol, doğru oynanırsa fazladan ödül
  [ROLE.GOLGE_LIDER]: 1.2,     // suikastçıları yönetme sorumluluğu
  [ROLE.HEKIM]: 1.1,
  [ROLE.MUHAFIZ]: 1.05,
  [ROLE.BAS_CASUS]: 1.05,
  [ROLE.SAHTE_PRENSES]: 1.0,
  [ROLE.ZEHIRBAZ]: 1.1,
  [ROLE.TAHT_TALIPLISI]: 1.0,  // solo win zaten yüksek taban puana sahip, çarpan sade tutulur
};

/**
 * @param {GameRoom} gameRoom - bitmiş oyunun durumu (gameRoom.players, gameRoom.winner)
 * @returns {Array<{ userId: string, role: string, points: number, breakdown: object }>}
 */
function calculateMatchScores(gameRoom) {
  const { players, winner } = gameRoom;

  return players.map((player) => {
    const breakdown = { participation: BASE_POINTS.PARTICIPATION };
    const isWinner = didPlayerWin(player, winner);

    if (isWinner) {
      breakdown.teamOrSoloWin =
        player.role === ROLE.TAHT_TALIPLISI ? BASE_POINTS.SOLO_WIN : BASE_POINTS.TEAM_WIN;
    }
    if (player.isAlive) {
      breakdown.survivalBonus = BASE_POINTS.SURVIVAL_BONUS;
    }
    if (player.role === ROLE.GIZLI_PRENSES && player.isAlive && winner === TEAM.IYILER) {
      breakdown.princessSurvivedBonus = BASE_POINTS.PRINCESS_SURVIVED_BONUS;
    }
    if (player.role === ROLE.SAHTE_PRENSES && !player.isAlive && player.diedCause === 'SUIKAST') {
      breakdown.decoySacrificeBonus = BASE_POINTS.DECOY_SACRIFICE_BONUS;
    }

    const rawTotal = Object.values(breakdown).reduce((a, b) => a + b, 0);
    const multiplier = ROLE_MULTIPLIER[player.role] ?? 1.0;
    const points = Math.round(rawTotal * multiplier);

    return { userId: player.userId, role: player.role, points, breakdown, multiplier, isWinner };
  });
}

function didPlayerWin(player, winnerTeam) {
  if (winnerTeam === TEAM.TARAFSIZ) {
    return player.role === ROLE.TAHT_TALIPLISI; // sadece taliplinin kendisi "kazandı" sayılır
  }
  return player.team === winnerTeam;
}

module.exports = { calculateMatchScores, BASE_POINTS, ROLE_MULTIPLIER };
