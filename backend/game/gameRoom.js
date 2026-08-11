// ============================================================
// gameRoom.js — Tek bir maçın durum makinesi (state machine)
// Gece/Gündüz fazları, yetenek çözümleme, oylama, kazanma koşulları.
// Aktif oyun durumu bilerek RAM'de tutulur (gerçek zamanlı, ephemeral);
// maç bittiğinde sonuç Postgres'e yazılır (bkz. persistGameResult).
// ============================================================

const { ROLE, TEAM, assignRoles, SUPPORTED_ROOM_SIZES, ROLE_SETS_BY_SIZE } = require('./roles');

const PHASE = {
  LOBBY: 'LOBBY',
  NIGHT: 'NIGHT',
  DAY_DISCUSSION: 'DAY_DISCUSSION',
  DAY_VOTE: 'DAY_VOTE',
  PENDING_EXECUTION: 'PENDING_EXECUTION',
  RESULTS: 'RESULTS',
};

// Bu değerler sadece HİÇ yönetici ayarı kaydedilmemişse kullanılan varsayılanlardır —
// owner/admin artık bunları admin panelinden istediği zaman değiştirebilir
// (bkz. server.js /api/admin/settings, GameRoom constructor'a "settings" olarak geçer).
const NIGHT_DURATION_MS = 20_000;
const DISCUSSION_DURATION_MS = 40_000;
const VOTE_DURATION_MS = 15_000;
const PENDING_EXECUTION_DURATION_MS = 15_000; // Gizli Prenses'in kartını açması için tanınan süre

const BOT_NAMES = ['Bot Zeynep', 'Bot Ahmet', 'Bot Elif', 'Bot Kerem', 'Bot Deniz', 'Bot Miray', 'Bot Yusuf', 'Bot Naz'];

class GameRoom {
  constructor(roomCode, io, roomSize = 8, onGameEnded = null, settings = {}) {
    if (!SUPPORTED_ROOM_SIZES.includes(roomSize)) {
      throw new Error(`Desteklenmeyen oda boyutu: ${roomSize}. Desteklenenler: ${SUPPORTED_ROOM_SIZES.join(', ')}`);
    }
    this.roomCode = roomCode;
    this.io = io;                 // socket.io namespace/instance referansı
    this.roomSize = roomSize;     // 4, 6 veya 8 — bu odanın kaç oyuncuyla oynanacağı
    this.onGameEnded = onGameEnded; // maç bitince çağrılır (bkz. server.js -> persistGameResult)
    this.players = [];            // { userId, username, socketId, role, team, isAlive, ... }
    this.hostUserId = null;
    this.phase = PHASE.LOBBY;
    this.dayNumber = 0;
    this.nightActions = {};       // bu gece toplanan aksiyonlar { actorRole: {...} }
    this.votes = {};              // { voterUserId: targetUserId|null }
    this.princessRevealUsed = false;
    this.pendingExecutionTargetUserId = null;
    this.shadowLeaderQueryUsed = false;
    this.poisonerUsed = false;
    this.doctorAntidoteUsed = false;
    this.doctorPoisonUsed = false;
    this.cupidUsed = false;
    this.loverUserIds = null; // Aşko'nun eşleştirdiği [userIdA, userIdB]
    this.decoyAssassinatedLastNight = false; // Sahte Prenses öldüyse suikastçılar bir gece pas geçer
    this.timer = null;
    this.winner = null;

    // Yönetici panelinden ayarlanabilen, oda oluşturulduğu anda "dondurulan"
    // değerler — bir oyun sürerken ayar değişse bile o odayı etkilemez, sadece
    // BUNDAN SONRA açılacak yeni odalara uygulanır (kafa karışıklığı olmasın diye).
    this.nightDurationMs = settings.nightDurationMs || NIGHT_DURATION_MS;
    this.dayDurationMs = settings.dayDurationMs || DISCUSSION_DURATION_MS;
    this.voteDurationMs = settings.voteDurationMs || VOTE_DURATION_MS;
    this.roleSet =
      Array.isArray(settings.roleSet) && settings.roleSet.length === roomSize ? settings.roleSet : null;
    this.roomName = settings.roomName || null;
  }

  // ---------- LOBİ ----------
  addPlayer(userId, username, socketId, avatarEmoji = '👤', avatarUrl = null) {
    // Aynı kullanıcı zaten odadaysa (örn. lobi sayfasından oda sayfasına geçişte
    // ikinci bir 'joinRoom' tetiklenmesi, sayfa yenileme ya da bağlantı kopup
    // yeniden bağlanma) yinelenen koltuk açmak yerine sadece socket bağlantısını
    // güncelle — bu, reconnect sonrası özel (hedefli) sunucu mesajlarının
    // (Baş Gözcü sonucu, rol bilgisi vb.) doğru socket'e ulaşmasını sağlar.
    const existing = this.players.find((p) => p.userId === userId);
    if (existing) {
      existing.socketId = socketId;
      existing.avatarEmoji = avatarEmoji;
      existing.avatarUrl = avatarUrl;
      return this.getPublicState();
    }
    if (this.players.length >= this.roomSize) throw new Error('Oda dolu.');
    if (!this.hostUserId) this.hostUserId = userId;
    this.players.push({
      userId,
      username,
      socketId,
      avatarEmoji,
      avatarUrl,
      role: null,
      team: null,
      isAlive: true,
      isReady: false, // "Hazırım" mekaniği: hem ilk başlangıçta hem tur sonrası yeni tur için kullanılır
    });
    return this.getPublicState();
  }

  // Yönetici tek tuşla odaya bir bot ekler (gerçek bir socket'i yoktur, otomatik
  // oynar — bkz. _runBotNightActions / _runBotDayVotes). Sadece lobi fazında ve
  // oda dolu değilken çalışır.
  addBot() {
    if (this.phase !== PHASE.LOBBY) return { ok: false, reason: 'Oyun başladıktan sonra bot eklenemez.' };
    if (this.players.length >= this.roomSize) return { ok: false, reason: 'Oda dolu.' };
    const usedNames = new Set(this.players.filter((p) => p.isBot).map((p) => p.username));
    const name = BOT_NAMES.find((n) => !usedNames.has(n)) || `Bot ${this.players.length + 1}`;
    const botUserId = `bot-${Math.random().toString(36).slice(2, 10)}`;
    if (!this.hostUserId) this.hostUserId = botUserId;
    this.players.push({
      userId: botUserId,
      username: name,
      socketId: null,
      avatarEmoji: '🤖',
      avatarUrl: null,
      role: null,
      team: null,
      isAlive: true,
      isReady: true, // botlar her zaman hazır, kimseyi beklemez
      isBot: true,
    });
    return { ok: true, publicState: this.getPublicState() };
  }

  removePlayer(userId) {
    this.players = this.players.filter((p) => p.userId !== userId);
    if (this.hostUserId === userId && this.players.length > 0) {
      this.hostUserId = this.players[0].userId;
    }
  }

  // Host, lobi fazındayken bir oyuncuyu (ya da botu) odadan atabilir (kendini atamaz).
  kickPlayer(requesterUserId, targetUserId) {
    if (requesterUserId !== this.hostUserId) return { ok: false, reason: 'Sadece oda kurucusu oyuncu atabilir.' };
    if (this.phase !== PHASE.LOBBY) return { ok: false, reason: 'Oyun başladıktan sonra oyuncu atılamaz.' };
    if (requesterUserId === targetUserId) return { ok: false, reason: 'Kendini atamazsın.' };
    const target = this.players.find((p) => p.userId === targetUserId);
    if (!target) return { ok: false, reason: 'Oyuncu bulunamadı.' };
    this.removePlayer(targetUserId);
    return { ok: true, kickedSocketId: target.socketId };
  }

  // Ortak sıfırlama mantığı: hem host'un erken bitirmesinde (abortGame) hem de
  // bir maç bitip herkes yeniden "Hazırım" dediğinde (setReady) kullanılır.
  // clearReady=false verilirse oyuncuların hazır durumu KORUNUR — bu, sonuç
  // ekranından direkt yeni bir tura geçerken (herkes zaten hazır demişken)
  // tekrar tek tek hazır basmalarını istemememiz için.
  _resetRoundState(clearReady) {
    clearTimeout(this.timer);
    this.phase = PHASE.LOBBY;
    this.dayNumber = 0;
    this.nightActions = {};
    this.votes = {};
    this.princessRevealUsed = false;
    this.pendingExecutionTargetUserId = null;
    this.shadowLeaderQueryUsed = false;
    this.poisonerUsed = false;
    this.doctorAntidoteUsed = false;
    this.doctorPoisonUsed = false;
    this.cupidUsed = false;
    this.loverUserIds = null;
    this.decoyAssassinatedLastNight = false;
    this.winner = null;
    this.players.forEach((p) => {
      p.role = null;
      p.team = null;
      p.isAlive = true;
      if (clearReady) p.isReady = Boolean(p.isBot); // botlar hep hazır kalır
    });
  }

  // Host, aktif bir maçı erken bitirip odayı lobiye döndürebilir (oyuncular kalır, roller sıfırlanır).
  abortGame(requesterUserId) {
    if (requesterUserId !== this.hostUserId) return { ok: false, reason: 'Sadece oda kurucusu oyunu sıfırlayabilir.' };
    if (this.phase === PHASE.LOBBY) return { ok: false, reason: 'Oyun zaten başlamadı.' };
    this._resetRoundState(true);
    return { ok: true };
  }

  // Oyuncu "Hazırım" durumunu değiştirir. Lobide (ilk başlangıç için) ve
  // sonuç ekranında (bir sonraki tura geçmek için) kullanılabilir. Sonuç
  // ekranındayken oda tamsa ve herkes hazırsa, oda LOBİYE KAPANMADAN otomatik
  // olarak yeni bir tur başlatılır.
  setReady(userId, isReady) {
    if (this.phase !== PHASE.LOBBY && this.phase !== PHASE.RESULTS) {
      return { ok: false, reason: 'Şu an hazır durumu değiştirilemez.' };
    }
    const player = this.players.find((p) => p.userId === userId);
    if (!player) return { ok: false, reason: 'Bu odada değilsin.' };
    player.isReady = Boolean(isReady);

    if (
      this.phase === PHASE.RESULTS &&
      this.players.length === this.roomSize &&
      this.players.every((p) => p.isReady)
    ) {
      this._resetRoundState(false); // hazır durumları koru, direkt yeni tura geç
      try {
        this.startGame();
        return { ok: true, newRoundStarted: true };
      } catch (err) {
        return { ok: true };
      }
    }
    return { ok: true };
  }

  startGame() {
    if (this.players.length !== this.roomSize) {
      throw new Error(`Oyun için ${this.roomSize} oyuncu gerekli.`);
    }
    if (this.players.some((p) => !p.isReady)) {
      throw new Error('Tüm oyuncuların "Hazırım" demesi gerekiyor.');
    }
    this.players = assignRoles(this.players, this.roomSize, this.roleSet);
    this.dayNumber = 1;
    // Her oyuncuya SADECE kendi rolünü gizlice gönder
    this.players.forEach((p) => {
      this.io.to(p.socketId).emit('gameStarted', {
        yourRole: p.role,
        team: p.team,
      });
    });
    // "Vampirler birbirini tanısın gece": suikastçı takımının üyeleri oyunun
    // başında birbirinin kimliğini öğrenir (gece boyunca geçerli, tekrar
    // sorgulamaya gerek yok — statik bir takım bilgisi).
    this._revealAssassinTeammates();
    this._goToNight();
  }

  _revealAssassinTeammates() {
    const assassins = this.players.filter((p) => p.team === TEAM.SUIKASTCILAR);
    if (assassins.length < 2) return;
    assassins.forEach((p) => {
      const teammates = assassins
        .filter((t) => t.userId !== p.userId)
        .map((t) => ({ userId: t.userId, username: t.username, role: t.role }));
      this.io.to(p.socketId).emit('teammatesRevealed', { teammates });
    });
  }

  // ---------- GECE FAZI ----------
  _goToNight() {
    this.phase = PHASE.NIGHT;
    this.nightActions = {};
    this._broadcastPhase();
    this._setPhaseTimer(this.nightDurationMs, () => this._resolveNight());
    this._runBotNightActions();
  }

  // Gece yeteneği kullanımı (client 'useAbility' event'i ile çağırır)
  submitNightAction(userId, abilityKey, targetUserId) {
    const actor = this.players.find((p) => p.userId === userId && p.isAlive);
    if (!actor || this.phase !== PHASE.NIGHT) return { ok: false, reason: 'Geçersiz istek.' };

    // ÖNEMLİ GÜVENLİK KONTROLÜ: istemci hangi yeteneği kullandığını kendi
    // beyan ediyor (abilityKey) — sunucu bunu KÖRÜ KÖRÜNE kabul ederse,
    // (örn. tarayıcı konsolundan) gerçekte o role sahip olmayan bir oyuncu
    // başka bir rolün yeteneğini tetikleyebilir. Her ability'nin gerçekten
    // o role ait olduğunu burada doğruluyoruz — proje genelinde zaten
    // benimsenen "istemciye güvenme" ilkesiyle (bkz. adminMiddleware) aynı mantık.
    const REQUIRED_ROLE = {
      GUARD_PROTECT: ROLE.MUHAFIZ,
      SPY_INVESTIGATE: ROLE.BAS_CASUS,
    };
    if (abilityKey === 'ASSASSIN_CHOOSE_TARGET') {
      // Suikast hedefi artık TEK bir rolün tekelinde değil — vampir takımının
      // (Gölge Lider + Zehirbaz) TÜM üyeleri oy verebilir, çoğunluk kazanır.
      if (actor.team !== TEAM.SUIKASTCILAR) {
        return { ok: false, reason: 'Bu yetenek senin rolüne ait değil.' };
      }
    } else if (REQUIRED_ROLE[abilityKey] && actor.role !== REQUIRED_ROLE[abilityKey]) {
      return { ok: false, reason: 'Bu yetenek senin rolüne ait değil.' };
    }

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
      case 'ASSASSIN_CHOOSE_TARGET': {
        if (this.decoyAssassinatedLastNight) {
          return { ok: false, reason: 'Bu gece suikastçılar pas geçmek zorunda.' };
        }
        this.nightActions.assassinVotes = this.nightActions.assassinVotes || {};
        this.nightActions.assassinVotes[userId] = targetUserId;
        // Vampir takımı birbirinin oyunu canlı görsün — day-vote ile aynı UX.
        const tally = {};
        Object.values(this.nightActions.assassinVotes).forEach((t) => {
          if (t) tally[t] = (tally[t] || 0) + 1;
        });
        this.players
          .filter((p) => p.team === TEAM.SUIKASTCILAR)
          .forEach((p) => this.io.to(p.socketId).emit('assassinVoteUpdate', { votes: tally }));
        break;
      }
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

  // Aşko'nun oyun boyu 1 kez kullanabildiği "iki oyuncuyu aşık et" gücü.
  submitCupidAction(userId, targetAUserId, targetBUserId) {
    const actor = this.players.find((p) => p.userId === userId && p.role === ROLE.ASKO && p.isAlive);
    if (!actor || this.phase !== PHASE.NIGHT) return { ok: false, reason: 'Geçersiz istek.' };
    if (this.cupidUsed) return { ok: false, reason: 'Bu güç zaten kullanıldı.' };
    if (!targetAUserId || !targetBUserId || targetAUserId === targetBUserId) {
      return { ok: false, reason: 'İki farklı oyuncu seçmelisin.' };
    }
    const a = this.players.find((p) => p.userId === targetAUserId && p.isAlive);
    const b = this.players.find((p) => p.userId === targetBUserId && p.isAlive);
    if (!a || !b) return { ok: false, reason: 'Geçersiz hedef.' };

    this.cupidUsed = true;
    this.loverUserIds = [targetAUserId, targetBUserId];
    const lovers = [
      { userId: a.userId, username: a.username },
      { userId: b.userId, username: b.username },
    ];
    [a, b].forEach((lover) => {
      this.io.to(lover.socketId).emit('loverRevealed', { lovers });
    });
    this.io.to(actor.socketId).emit('abilityResult', { abilityKey: 'CUPID_MATCH_LOVERS', result: 'OK', lovers });
    return { ok: true };
  }

  // Aşk kırığı zinciri: aşıklardan biri ölürse diğeri de hemen ölür — "sadece
  // birlikte kazanabilirler" kuralının doğal bir sonucu. deaths dizisini
  // (henüz uygulanmamış, sadece toplanmış ölüm listesini) yerinde günceller.
  _applyLoverCascade(deaths) {
    if (!this.loverUserIds) return;
    const initial = [...deaths];
    initial.forEach(({ userId }) => {
      if (!this.loverUserIds.includes(userId)) return;
      const otherId = this.loverUserIds.find((id) => id !== userId);
      const other = this.players.find((p) => p.userId === otherId);
      if (other && other.isAlive && !deaths.some((d) => d.userId === otherId)) {
        deaths.push({ userId: otherId, cause: 'ASIK_ACISI' });
      }
    });
  }

  _resolveNight() {
    const { protectedUserId, antidoteUserId, doctorPoisonUserId, assassinVotes } = this.nightActions;
    const deaths = [];

    // Vampir takımının oyladığı hedef: en çok oy alan kazanır (day-vote ile
    // aynı mantık). Eşitlikte kimse ölmez (o gece suikast girişimi başarısız).
    let assassinTargetUserId = null;
    if (assassinVotes) {
      const tally = {};
      Object.values(assassinVotes).forEach((t) => {
        if (t) tally[t] = (tally[t] || 0) + 1;
      });
      const sorted = Object.entries(tally).sort((a, b) => b[1] - a[1]);
      if (sorted.length > 0 && !(sorted.length > 1 && sorted[1][1] === sorted[0][1])) {
        assassinTargetUserId = sorted[0][0];
      }
    }

    // Suikast hedefi: korunmuyorsa ve panzehirle kurtarılmıyorsa ölür
    if (assassinTargetUserId) {
      const saved = assassinTargetUserId === protectedUserId || assassinTargetUserId === antidoteUserId;
      if (!saved) deaths.push({ userId: assassinTargetUserId, cause: 'SUIKAST' });
    }
    // Hekimin zehri (korumadan bağımsız, doğrudan öldürür)
    if (doctorPoisonUserId) {
      deaths.push({ userId: doctorPoisonUserId, cause: 'ZEHIR' });
    }

    // Aşk kırığı zinciri (bkz. yukarısı)
    this._applyLoverCascade(deaths);

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
    // ÖNEMLİ: ölümler sadece 'nightResult' ile değil, players[] listesindeki
    // isAlive alanını da güncelleyen bir 'roomUpdate' ile yayınlanmalı —
    // aksi halde istemcideki oturma düzeni/oy listesi/sesli sohbet mute mantığı
    // (hepsi `players` state'ine bakıyor) hiçbir zaman "öldü" durumunu görmez.
    this.io.to(this.roomCode).emit('roomUpdate', this.getPublicState());

    const winner = this._checkWinCondition();
    if (winner) return this._endGame(winner);

    this._goToDayDiscussion();
  }

  // ---------- GÜNDÜZ FAZI ----------
  _goToDayDiscussion() {
    this.phase = PHASE.DAY_DISCUSSION;
    this._broadcastPhase();
    this._setPhaseTimer(this.dayDurationMs, () => this._goToVote());
  }

  _goToVote() {
    this.phase = PHASE.DAY_VOTE;
    this.votes = {};
    this._broadcastPhase();
    this._setPhaseTimer(this.voteDurationMs, () => this._resolveVote());
    this._runBotDayVotes();
  }

  castVote(voterUserId, targetUserId) {
    const voter = this.players.find((p) => p.userId === voterUserId && p.isAlive);
    if (!voter || this.phase !== PHASE.DAY_VOTE) return { ok: false, reason: 'Geçersiz istek.' };
    // İstemci tarafı zaten sadece hayatta olanları listeliyor, ama sunucu
    // tarafında da doğrulamadan asla emin olamayız (bkz. proje genelindeki
    // "istemciye güvenme" ilkesi) — ölü bir oyuncuya oy verilmesini engelle.
    if (targetUserId) {
      const target = this.players.find((p) => p.userId === targetUserId);
      if (!target || !target.isAlive) {
        return { ok: false, reason: 'Ölmüş bir oyuncuya oy veremezsin.' };
      }
    }
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

    this._goToPendingExecution(topUserId);
  }

  // İdam kesinleşmeden önceki kısa bekleme penceresi: hedef, Gizli Prenses ise
  // ve henüz kartını açmadıysa, bu süre içinde claimPrincess çağırıp idamı iptal edebilir.
  _goToPendingExecution(targetUserId) {
    this.phase = PHASE.PENDING_EXECUTION;
    this.pendingExecutionTargetUserId = targetUserId;
    this.io.to(this.roomCode).emit('pendingExecution', { targetUserId });
    this._setPhaseTimer(PENDING_EXECUTION_DURATION_MS, () => this._executePlayer(targetUserId));

    // Bot Gizli Prenses her zaman kartını açar (asla bluff yapmaz) — aksi
    // halde bot oyunu tıkardı, kimse onun adına claimPrincess çağıramaz.
    const target = this.players.find((p) => p.userId === targetUserId);
    if (target?.isBot && target.role === ROLE.GIZLI_PRENSES && !this.princessRevealUsed) {
      setTimeout(() => {
        if (this.phase === PHASE.PENDING_EXECUTION && this.pendingExecutionTargetUserId === targetUserId) {
          this.claimPrincess(targetUserId);
        }
      }, 1200);
    }
  }

  // Gizli Prenses'in idam iptal mekaniği: idam edilecek kişi Prenses ise
  // ve kartını açmayı seçerse (client 'claimPrincess' event'i) idam iptal edilir.
  claimPrincess(userId) {
    if (this.phase !== PHASE.PENDING_EXECUTION) {
      return { ok: false, reason: 'Şu an idam bekleme aşamasında değiliz.' };
    }
    if (this.princessRevealUsed) return { ok: false, reason: 'Bu güç zaten kullanıldı.' };
    const player = this.players.find((p) => p.userId === userId);
    if (!player || player.role !== ROLE.GIZLI_PRENSES) return { ok: false, reason: 'Sen Prenses değilsin.' };
    if (userId !== this.pendingExecutionTargetUserId) return { ok: false, reason: 'Sıra sende değil.' };

    this.princessRevealUsed = true;
    clearTimeout(this.timer);
    this.pendingExecutionTargetUserId = null;
    this.io.to(this.roomCode).emit('princessRevealed', { userId });
    this._goToNightAfterExecution(); // idam iptal, gece kaldı
    return { ok: true };
  }

  _executePlayer(userId) {
    this.pendingExecutionTargetUserId = null;
    const deaths = [{ userId, cause: 'IDAM' }];
    this._applyLoverCascade(deaths); // idam edilen bir aşıksa, diğeri de kalbi kırılarak ölür

    deaths.forEach((d) => {
      const player = this.players.find((p) => p.userId === d.userId);
      if (player) {
        player.isAlive = false;
        player.diedOnDay = this.dayNumber;
        player.diedCause = d.cause;
      }
    });

    const executedPlayer = this.players.find((p) => p.userId === userId);
    this.io.to(this.roomCode).emit('executionResult', {
      userId,
      roleReveal: executedPlayer?.role,
      extraDeaths: deaths.filter((d) => d.userId !== userId), // kalbi kırılan aşık, varsa
    });
    this.io.to(this.roomCode).emit('roomUpdate', this.getPublicState());

    const winner = this._checkWinCondition();
    if (winner) return this._endGame(winner);
    this._goToNightAfterExecution();
  }

  _goToNightAfterExecution() {
    this.dayNumber += 1;
    this._goToNight();
  }

  // ---------- BOTLARIN OTOMATİK OYNAMASI ----------
  _runBotNightActions() {
    const bots = this.players.filter((p) => p.isBot && p.isAlive);
    bots.forEach((bot) => {
      const delay = 1500 + Math.floor(Math.random() * 3000);
      setTimeout(() => {
        if (this.phase !== PHASE.NIGHT) return; // faz değişmişse (round sıfırlanmış olabilir) sessizce çık
        this._botActNight(bot);
      }, delay);
    });
  }

  _botActNight(bot) {
    const others = this.players.filter((p) => p.isAlive && p.userId !== bot.userId);
    if (!others.length) return;
    const randomOf = (list) => list[Math.floor(Math.random() * list.length)];

    switch (bot.role) {
      case ROLE.MUHAFIZ:
        this.submitNightAction(bot.userId, 'GUARD_PROTECT', randomOf(others).userId);
        break;
      case ROLE.BAS_CASUS:
        this.submitNightAction(bot.userId, 'SPY_INVESTIGATE', randomOf(others).userId);
        break;
      case ROLE.GOLGE_LIDER:
      case ROLE.ZEHIRBAZ: {
        const nonTeammates = others.filter((p) => p.team !== TEAM.SUIKASTCILAR);
        const pool = nonTeammates.length ? nonTeammates : others;
        this.submitNightAction(bot.userId, 'ASSASSIN_CHOOSE_TARGET', randomOf(pool).userId);
        break;
      }
      case ROLE.HEKIM:
        if (!this.doctorAntidoteUsed && Math.random() < 0.6) {
          this.submitDoctorAction(bot.userId, 'antidote', randomOf(others).userId);
        } else if (!this.doctorPoisonUsed && Math.random() < 0.2) {
          this.submitDoctorAction(bot.userId, 'poison', randomOf(others).userId);
        }
        break;
      case ROLE.ASKO:
        if (!this.cupidUsed && others.length >= 2) {
          const shuffled = [...others].sort(() => Math.random() - 0.5);
          this.submitCupidAction(bot.userId, shuffled[0].userId, shuffled[1].userId);
        }
        break;
      default:
        break; // pasif roller (Sahte Prenses, Gizli Prenses, Taht Taliplisi) gece bir şey yapmaz
    }
  }

  _runBotDayVotes() {
    const bots = this.players.filter((p) => p.isBot && p.isAlive);
    bots.forEach((bot) => {
      const delay = 1000 + Math.floor(Math.random() * 3000);
      setTimeout(() => {
        if (this.phase !== PHASE.DAY_VOTE) return;
        const others = this.players.filter((p) => p.isAlive && p.userId !== bot.userId);
        if (!others.length) return;
        const target = others[Math.floor(Math.random() * others.length)];
        this.castVote(bot.userId, target.userId);
      }, delay);
    });
  }

  // ---------- KAZANMA KOŞULLARI ----------
  _checkWinCondition() {
    const alive = this.players.filter((p) => p.isAlive);

    // Aşıklar: eğer hayatta kalan SADECE ikisiyse (başka kimse kalmadıysa)
    // takımlarından bağımsız olarak birlikte kazanırlar — en yüksek öncelik,
    // çünkü "sadece aşıklarıyla kazanabilsin köylüyle kazanamasın" isteğidir.
    if (
      this.loverUserIds &&
      alive.length === 2 &&
      this.loverUserIds.every((id) => alive.some((p) => p.userId === id))
    ) {
      return TEAM.ASIKLAR;
    }

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
    if (typeof this.onGameEnded === 'function') {
      this.onGameEnded(this);
    }
  }

  // ---------- YAZILI SOHBET ----------
  // Sesli sohbetle aynı mantık: gündüz herkes birbirine yazar, gece ise
  // sadece suikastçılar kendi gizli kanallarında birbirine yazabilir.
  sendChatMessage(userId, username, text) {
    const trimmed = String(text || '').slice(0, 500).trim();
    if (!trimmed) return { ok: false, reason: 'Boş mesaj gönderilemez.' };
    const sender = this.players.find((p) => p.userId === userId);
    if (!sender) return { ok: false, reason: 'Bu odada değilsin.' };

    const isNight = this.phase === PHASE.NIGHT;
    const isAssassin = sender.team === TEAM.SUIKASTCILAR;
    const payload = {
      userId,
      username,
      text: trimmed,
      channel: isNight ? 'night' : 'day',
    };

    if (isNight) {
      if (!isAssassin) return { ok: false, reason: 'Gece genel sohbet kapalı — sadece suikastçılar gizli kanalda yazabilir.' };
      this.players
        .filter((p) => p.team === TEAM.SUIKASTCILAR)
        .forEach((p) => this.io.to(p.socketId).emit('chatMessage', payload));
    } else {
      this.io.to(this.roomCode).emit('chatMessage', payload);
    }
    return { ok: true };
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
      roomSize: this.roomSize,
      roomName: this.roomName,
      hostUserId: this.hostUserId,
      phase: this.phase,
      roleSet: this.roleSet || ROLE_SETS_BY_SIZE[this.roomSize] || [],
      players: this.players.map((p) => ({
        userId: p.userId,
        username: p.username,
        avatarEmoji: p.avatarEmoji,
        avatarUrl: p.avatarUrl || null,
        isAlive: p.isAlive,
        isReady: Boolean(p.isReady),
        isBot: Boolean(p.isBot),
      })),
    };
  }

  // Admin panelinin canlı odaları listelemesi için (bkz. server.js /api/admin/rooms)
  getAdminSummary() {
    return {
      roomCode: this.roomCode,
      roomSize: this.roomSize,
      phase: this.phase,
      dayNumber: this.dayNumber,
      playerCount: this.players.length,
      hostUserId: this.hostUserId,
    };
  }
}

module.exports = { GameRoom, PHASE };
