// ============================================================
// gameRoom.js — Tek bir maçın durum makinesi (state machine)
// Gece/Gündüz fazları, yetenek çözümleme, oylama, kazanma koşulları.
// Aktif oyun durumu bilerek RAM'de tutulur (gerçek zamanlı, ephemeral);
// maç bittiğinde sonuç Postgres'e yazılır (bkz. persistGameResult).
// ============================================================

const { ROLE, TEAM, assignRoles } = require('./roles');

const PHASE = {
  LOBBY: 'LOBBY',
  NIGHT: 'NIGHT',
  DAY_DISCUSSION: 'DAY_DISCUSSION',
  DAY_VOTE: 'DAY_VOTE',
  EXECUTION: 'EXECUTION',
  RESULTS: 'RESULTS',
};

const NIGHT_DURATION_MS = 45_000;
const DISCUSSION_DURATION_MS = 90_000;
const VOTE_DURATION_MS = 30_000;

class GameRoom {
  constructor(roomCode, io) {
    this.roomCode = roomCode;
    this.io = io;                 // socket.io namespace/instance referansı
    this.players = [];            // { userId, username, socketId, role, team, isAlive, ... }
    this.hostUserId = null;
    this.phase = PHASE.LOBBY;
    this.dayNumber = 0;
    this.nightActions = {};       // bu gece toplanan aksiyonlar { actorRole: {...} }
    this.votes = {};              // { voterUserId: targetUserId|null }
    this.princessRevealUsed = false;
    this.shadowLeaderQueryUsed = false;
    this.poisonerUsed = false;
    this.doctorAntidoteUsed = false;
    this.doctorPoisonUsed = false;
    this.decoyAssassinatedLastNight = false; // Sahte Prenses öldüyse suikastçılar bir gece pas geçer
    this.timer = null;
    this.winner = null;
  }

  // ---------- LOBİ ----------
  addPlayer(userId, username, socketId) {
    if (this.players.length >= 8) throw new Error('Oda dolu.');
    if (!this.hostUserId) this.hostUserId = userId;
    this.players.push({ userId, username, socketId, role: null, team: null, isAlive: true });
    return this.getPublicState();
  }

  removePlayer(userId) {
    this.players = this.players.filter((p) => p.userId !== userId);
    if (this.hostUserId === userId && this.players.length > 0) {
      this.hostUserId = this.players[0].userId;
    }
  }

  startGame() {
    if (this.players.length !== 8) throw new Error('Oyun için 8 oyuncu gerekli.');
    this.players = assignRoles(this.players);
    this.dayNumber = 1;
    // Her oyuncuya SADECE kendi rolünü gizlice gönder
    this.players.forEach((p) => {
      this.io.to(p.socketId).emit('gameStarted', {
        yourRole: p.role,
        team: p.team,
      });
    });
    this._goToNight();
  }

  // ---------- GECE FAZI ----------
  _goToNight() {
    this.phase = PHASE.NIGHT;
    this.nightActions = {};
    this._broadcastPhase();
    this._setPhaseTimer(NIGHT_DURATION_MS, () => this._resolveNight());
  }

  // Gece yeteneği kullanımı (client 'useAbility' event'i ile çağırır)
  submitNightAction(userId, abilityKey, targetUserId) {
    const actor = this.players.find((p) => p.userId === userId && p.isAlive);
    if (!actor || this.phase !== PHASE.NIGHT) return { ok: false, reason: 'Geçersiz istek.' };

    // Zehirbaz tarafından kilitlenmiş oyuncu aksiyon gönderemez
    if (this.nightActions.lockedRole === actor.role) {
      return { ok: false, reason: 'Yeteneğin bu gece kilitlendi.' };
    }

    switch (abilityKey) {
      case 'GUARD_PROTECT':
        this.nightActions.protectedUserId = targetUserId;
        break;
      case 'DOCTOR_ANTIDOTE_OR_POISON':
        // Hekim antidot/zehir seçimi ayrı parametre (mode) gerektirdiği için
        // bu case'i kullanma; bunun yerine submitDoctorAction(userId, mode, targetUserId) çağır.
        return { ok: false, reason: 'Hekim için submitDoctorAction kullanın.' };
      case 'SPY_INVESTIGATE': {
        const target = this.players.find((p) => p.userId === targetUserId);
        const isDangerous = target && target.team === TEAM.SUIKASTCILAR;
        this.io.to(actor.socketId).emit('abilityResult', {
          abilityKey,
          targetUserId,
          result: isDangerous ? 'TEHLIKELI' : 'MASUM',
        });
        break;
      }
      case 'ASSASSIN_CHOOSE_TARGET':
        if (this.decoyAssassinatedLastNight) {
          return { ok: false, reason: 'Bu gece suikastçılar pas geçmek zorunda.' };
        }
        this.nightActions.assassinTargetUserId = targetUserId;
        break;
      case 'POISONER_LOCK_ABILITY':
        if (this.poisonerUsed) return { ok: false, reason: 'Zehirbaz gücünü zaten kullandı.' };
        this.poisonerUsed = true;
        this.nightActions.lockedRole = targetUserId; // burada targetUserId yerine rol adı geçirilir
        break;
      default:
        return { ok: false, reason: 'Bilinmeyen yetenek.' };
    }
    return { ok: true };
  }

  submitDoctorAction(userId, mode, targetUserId) {
    const actor = this.players.find((p) => p.userId === userId && p.role === ROLE.HEKIM && p.isAlive);
    if (!actor || this.phase !== PHASE.NIGHT) return { ok: false, reason: 'Geçersiz istek.' };
    if (mode === 'antidote') {
      if (this.doctorAntidoteUsed) return { ok: false, reason: 'Panzehir zaten kullanıldı.' };
      this.doctorAntidoteUsed = true;
      this.nightActions.antidoteUserId = targetUserId;
    } else if (mode === 'poison') {
      if (this.doctorPoisonUsed) return { ok: false, reason: 'Zehir zaten kullanıldı.' };
      this.doctorPoisonUsed = true;
      this.nightActions.doctorPoisonUserId = targetUserId;
    }
    return { ok: true };
  }

  // Gölge Lider'in oyun boyu 1 kez kullanabildiği "Prenses mi?" sorgusu
  submitShadowLeaderQuery(userId, targetUserId) {
    if (this.shadowLeaderQueryUsed) return { ok: false, reason: 'Bu güç zaten kullanıldı.' };
    const actor = this.players.find((p) => p.userId === userId && p.role === ROLE.GOLGE_LIDER && p.isAlive);
    if (!actor) return { ok: false, reason: 'Yetkisiz.' };
    this.shadowLeaderQueryUsed = true;
    const target = this.players.find((p) => p.userId === targetUserId);
    const isPrincess = target && target.role === ROLE.GIZLI_PRENSES;
    this.io.to(actor.socketId).emit('abilityResult', {
      abilityKey: 'QUERY_IS_PRINCESS',
      targetUserId,
      result: isPrincess ? 'PRENSES' : 'PRENSES_DEGIL',
    });
    return { ok: true };
  }

  _resolveNight() {
    const { protectedUserId, assassinTargetUserId, antidoteUserId, doctorPoisonUserId } = this.nightActions;
    const deaths = [];

    // Suikast hedefi: korunmuyorsa ve panzehirle kurtarılmıyorsa ölür
    if (assassinTargetUserId) {
      const saved = assassinTargetUserId === protectedUserId || assassinTargetUserId === antidoteUserId;
      if (!saved) deaths.push({ userId: assassinTargetUserId, cause: 'SUIKAST' });
    }
    // Hekimin zehri (korumadan bağımsız, doğrudan öldürür)
    if (doctorPoisonUserId) {
      deaths.push({ userId: doctorPoisonUserId, cause: 'ZEHIR' });
    }

    deaths.forEach(({ userId, cause }) => {
      const victim = this.players.find((p) => p.userId === userId);
      if (victim) {
        victim.isAlive = false;
        victim.diedOnDay = this.dayNumber;
        victim.diedCause = cause;
      }
    });

    // Sahte Prenses öldüyse: suikastçılar bir sonraki gece saldıramaz
    const decoyDied = deaths.some((d) => {
      const p = this.players.find((pl) => pl.userId === d.userId);
      return p && p.role === ROLE.SAHTE_PRENSES;
    });
    this.decoyAssassinatedLastNight = decoyDied;

    this.io.to(this.roomCode).emit('nightResult', {
      deaths: deaths.map((d) => ({ userId: d.userId, cause: d.cause })),
    });

    const winner = this._checkWinCondition();
    if (winner) return this._endGame(winner);

    this._goToDayDiscussion();
  }

  // ---------- GÜNDÜZ FAZI ----------
  _goToDayDiscussion() {
    this.phase = PHASE.DAY_DISCUSSION;
    this._broadcastPhase();
    this._setPhaseTimer(DISCUSSION_DURATION_MS, () => this._goToVote());
  }

  _goToVote() {
    this.phase = PHASE.DAY_VOTE;
    this.votes = {};
    this._broadcastPhase();
    this._setPhaseTimer(VOTE_DURATION_MS, () => this._resolveVote());
  }

  castVote(voterUserId, targetUserId) {
    const voter = this.players.find((p) => p.userId === voterUserId && p.isAlive);
    if (!voter || this.phase !== PHASE.DAY_VOTE) return { ok: false, reason: 'Geçersiz istek.' };
    this.votes[voterUserId] = targetUserId || null; // null = çekimser
    this.io.to(this.roomCode).emit('voteUpdate', { votes: this._tallyVotes() });
    return { ok: true };
  }

  _tallyVotes() {
    const tally = {};
    Object.values(this.votes).forEach((targetUserId) => {
      if (!targetUserId) return;
      tally[targetUserId] = (tally[targetUserId] || 0) + 1;
    });
    return tally;
  }

  _resolveVote() {
    const tally = this._tallyVotes();
    const sorted = Object.entries(tally).sort((a, b) => b[1] - a[1]);
    if (sorted.length === 0) {
      return this._goToNightAfterExecution(); // kimse idam edilmedi
    }
    const [topUserId, topVotes] = sorted[0];
    const isTie = sorted.length > 1 && sorted[1][1] === topVotes;
    if (isTie) return this._goToNightAfterExecution();

    this._executePlayer(topUserId);
  }

  // Gizli Prenses'in idam iptal mekaniği: idam edilecek kişi Prenses ise
  // ve kartını açmayı seçerse (client 'claimPrincess' event'i) idam iptal edilir.
  claimPrincess(userId, pendingExecutionTargetUserId) {
    if (this.princessRevealUsed) return { ok: false, reason: 'Bu güç zaten kullanıldı.' };
    const player = this.players.find((p) => p.userId === userId);
    if (!player || player.role !== ROLE.GIZLI_PRENSES) return { ok: false, reason: 'Sen Prenses değilsin.' };
    if (userId !== pendingExecutionTargetUserId) return { ok: false, reason: 'Sıra sende değil.' };

    this.princessRevealUsed = true;
    this.io.to(this.roomCode).emit('princessRevealed', { userId });
    this._goToNightAfterExecution(); // idam iptal, gece kaldı
    return { ok: true };
  }

  _executePlayer(userId) {
    const player = this.players.find((p) => p.userId === userId);
    if (player) {
      player.isAlive = false;
      player.diedOnDay = this.dayNumber;
      player.diedCause = 'IDAM';
    }
    this.io.to(this.roomCode).emit('executionResult', { userId, roleReveal: player?.role });

    const winner = this._checkWinCondition();
    if (winner) return this._endGame(winner);
    this._goToNightAfterExecution();
  }

  _goToNightAfterExecution() {
    this.dayNumber += 1;
    this._goToNight();
  }

  // ---------- KAZANMA KOŞULLARI ----------
  _checkWinCondition() {
    const alive = this.players.filter((p) => p.isAlive);
    const princess = this.players.find((p) => p.role === ROLE.GIZLI_PRENSES);
    const claimant = this.players.find((p) => p.role === ROLE.TAHT_TALIPLISI);
    const aliveEvil = alive.filter((p) => p.team === TEAM.SUIKASTCILAR);
    const aliveGoodOrNeutral = alive.filter((p) => p.team !== TEAM.SUIKASTCILAR);

    // Taht Taliplisi: Prenses öldü VE taliplisi hâlâ hayattaysa, oyun onun içinde
    // sona erer (diğer koşullardan önce kontrol edilir).
    if (princess && !princess.isAlive && claimant && claimant.isAlive) {
      return TEAM.TARAFSIZ;
    }
    // Suikastçılar kazanır: Prenses öldü (ve Taliplisi de yoksa/öldüyse)
    if (princess && !princess.isAlive) {
      return TEAM.SUIKASTCILAR;
    }
    // İyiler kazanır: tüm suikastçılar elendi
    if (aliveEvil.length === 0) {
      return TEAM.IYILER;
    }
    // Suikastçılar sayıca iyileri geçerse (opsiyonel ek kural, dengeleme için)
    if (aliveEvil.length >= aliveGoodOrNeutral.length) {
      return TEAM.SUIKASTCILAR;
    }
    return null;
  }

  _endGame(winnerTeam) {
    this.phase = PHASE.RESULTS;
    this.winner = winnerTeam;
    clearTimeout(this.timer);
    this.io.to(this.roomCode).emit('gameEnded', {
      winningTeam: winnerTeam,
      roleReveal: this.players.map((p) => ({ userId: p.userId, role: p.role, isAlive: p.isAlive })),
    });
    // persistGameResult(this) -> Postgres'e yaz (bkz. scoring.js + server.js)
  }

  // ---------- YARDIMCILAR ----------
  _broadcastPhase() {
    this.io.to(this.roomCode).emit('phaseChanged', {
      phase: this.phase,
      dayNumber: this.dayNumber,
    });
  }

  _setPhaseTimer(durationMs, callback) {
    clearTimeout(this.timer);
    this.timer = setTimeout(callback, durationMs);
  }

  getPublicState() {
    return {
      roomCode: this.roomCode,
      hostUserId: this.hostUserId,
      phase: this.phase,
      players: this.players.map((p) => ({
        userId: p.userId,
        username: p.username,
        isAlive: p.isAlive,
      })),
    };
  }
}

module.exports = { GameRoom, PHASE };
