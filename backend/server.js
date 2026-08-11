// ============================================================
// server.js — "Sarayda Gece: Gizli Prenses" ana backend girişi
// Express (REST: auth, stats, leaderboard) + Socket.io (gerçek zamanlı oyun)
// ============================================================

require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const { RtcTokenBuilder, RtcRole } = require('agora-token');

const { GameRoom, PHASE } = require('./game/gameRoom');
const { calculateMatchScores } = require('./game/scoring');
const { SUPPORTED_ROOM_SIZES } = require('./game/roles');

const app = express();
app.use(cors());
app.use(express.json());

// Not: Supabase (ve çoğu barındırılan Postgres) SSL zorunlu tutar; aşağıdaki
// ssl ayarı olmadan Render üzerinde "self signed certificate" hatası alınır.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

// ---------- REST: AUTH ----------
app.post('/api/auth/register', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'username, email, password zorunlu.' });
  }
  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash)
       VALUES ($1,$2,$3) RETURNING id, username, email, avatar_emoji, is_admin`,
      [username, email, passwordHash]
    );
    const user = result.rows[0];
    await pool.query(`INSERT INTO player_stats (user_id) VALUES ($1)`, [user.id]);
    const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
    res.json({
      token,
      user: { id: user.id, username: user.username, email: user.email, avatarEmoji: user.avatar_emoji, isAdmin: user.is_admin },
    });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Kullanıcı adı veya e-posta zaten kayıtlı.' });
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const result = await pool.query(`SELECT * FROM users WHERE email = $1`, [email]);
  const user = result.rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'E-posta veya şifre hatalı.' });
  }
  if (user.is_banned) {
    return res.status(403).json({ error: 'Bu hesap yönetici tarafından askıya alınmış.' });
  }
  const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
  res.json({
    token,
    user: { id: user.id, username: user.username, email: user.email, avatarEmoji: user.avatar_emoji, isAdmin: user.is_admin },
  });
});

app.post('/api/auth/change-password', async (req, res) => {
  try {
    const auth = requireAuth(req);
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'Mevcut şifre ve en az 6 karakterlik yeni şifre gerekli.' });
    }
    const result = await pool.query(`SELECT * FROM users WHERE id = $1`, [auth.userId]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(currentPassword, user.password_hash))) {
      return res.status(401).json({ error: 'Mevcut şifre hatalı.' });
    }
    const newHash = await bcrypt.hash(newPassword, 10);
    await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [newHash, auth.userId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(401).json({ error: 'Geçersiz oturum.' });
  }
});

function requireAuth(req) {
  const header = req.headers.authorization || '';
  const token = header.replace('Bearer ', '');
  return jwt.verify(token, JWT_SECRET); // geçersizse fırlatır, çağıran yakalamalı
}

function authMiddleware(req, res, next) {
  try {
    req.auth = requireAuth(req);
    next();
  } catch {
    res.status(401).json({ error: 'Geçersiz oturum.' });
  }
}

// Site geneli admin paneli: sadece users.is_admin = true olan hesaplar girebilir.
// Bilinçli olarak JWT içine "isAdmin" claim'i koymak yerine her istekte DB'den
// taze okuyoruz — bir hesabın admin yetkisi geri alındığında eski token'lar
// hâlâ geçerli olsa da admin erişimi anında kesilsin diye.
async function adminMiddleware(req, res, next) {
  try {
    req.auth = requireAuth(req);
  } catch {
    return res.status(401).json({ error: 'Geçersiz oturum.' });
  }
  const result = await pool.query(`SELECT is_admin FROM users WHERE id = $1`, [req.auth.userId]);
  if (!result.rows[0]?.is_admin) {
    return res.status(403).json({ error: 'Bu işlem için yönetici yetkisi gerekiyor.' });
  }
  next();
}

// Baş yönetici (owner): TEK hesap, sınırsız yetki (admin atama/geri alma, hesap
// silme). Normal admin'ler (is_admin=true ama is_owner=false) bu işlemleri
// YAPAMAZ — "adminin yetenekleri sınırlı kalsın" kararına göre.
async function ownerMiddleware(req, res, next) {
  try {
    req.auth = requireAuth(req);
  } catch {
    return res.status(401).json({ error: 'Geçersiz oturum.' });
  }
  const result = await pool.query(`SELECT is_owner FROM users WHERE id = $1`, [req.auth.userId]);
  if (!result.rows[0]?.is_owner) {
    return res.status(403).json({ error: 'Bu işlem için baş yönetici (owner) yetkisi gerekiyor.' });
  }
  next();
}

// ---------- REST: PROFİL / LİDERLİK TABLOSU ----------
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Sarayda Gece backend çalışıyor.' });
});

app.get('/api/stats/me', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM player_stats WHERE user_id = $1`, [req.auth.userId]);
    res.json(result.rows[0] || {});
  } catch (err) {
    console.error('DB hatası (/api/stats/me):', err.message);
    res.status(500).json({ error: 'Veritabanına bağlanılamadı.' });
  }
});

app.get('/api/leaderboard', async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM leaderboard LIMIT 50`);
    res.json(result.rows);
  } catch (err) {
    console.error('DB hatası (/api/leaderboard):', err.message);
    res.status(500).json({ error: 'Veritabanına bağlanılamadı.' });
  }
});

// Herkesin görebildiği, ROL BAZLI "en çok kazananlar" sıralaması.
// Her rol için en çok o rolle kazanmış ilk 5 oyuncuyu döner.
app.get('/api/leaderboard/by-role', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT prs.role_key, u.username, u.avatar_emoji, u.avatar_url, prs.wins, prs.games_played
       FROM player_role_stats prs
       JOIN users u ON u.id = prs.user_id
       WHERE prs.wins > 0
       ORDER BY prs.role_key, prs.wins DESC, prs.games_played ASC`
    );
    const byRole = {};
    for (const row of result.rows) {
      if (!byRole[row.role_key]) byRole[row.role_key] = [];
      if (byRole[row.role_key].length < 5) byRole[row.role_key].push(row);
    }
    res.json(byRole);
  } catch (err) {
    console.error('DB hatası (/api/leaderboard/by-role):', err.message);
    res.status(500).json({ error: 'Veritabanına bağlanılamadı.' });
  }
});

// ---------- REST: PROFİL GÖRÜNTÜLEME / DÜZENLEME ----------
const AVAILABLE_AVATAR_EMOJIS = ['👑', '🗡️', '🛡️', '🔮', '🕯️', '🦉', '🐺', '🌙', '⚜️', '🎭'];

app.get('/api/profile/me', authMiddleware, async (req, res) => {
  try {
    const userResult = await pool.query(
      `SELECT id, username, email, avatar_emoji, avatar_url, avatar_pending_url, avatar_status,
              is_admin, is_owner, profile_locked, created_at
       FROM users WHERE id = $1`,
      [req.auth.userId]
    );
    const statsResult = await pool.query(`SELECT * FROM player_stats WHERE user_id = $1`, [req.auth.userId]);
    if (!userResult.rows[0]) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
    res.json({ ...userResult.rows[0], stats: statsResult.rows[0] || {} });
  } catch (err) {
    console.error('DB hatası (/api/profile/me):', err.message);
    res.status(500).json({ error: 'Veritabanına bağlanılamadı.' });
  }
});

app.patch('/api/profile/me', authMiddleware, async (req, res) => {
  const { username, avatarEmoji } = req.body;
  if (avatarEmoji && !AVAILABLE_AVATAR_EMOJIS.includes(avatarEmoji)) {
    return res.status(400).json({ error: 'Geçersiz avatar seçimi.' });
  }
  try {
    const lockCheck = await pool.query(`SELECT profile_locked FROM users WHERE id = $1`, [req.auth.userId]);
    if (lockCheck.rows[0]?.profile_locked) {
      return res.status(403).json({ error: 'Bir yönetici profilini (ad/fotoğraf) değiştirmeni kilitledi.' });
    }
    const result = await pool.query(
      `UPDATE users SET
         username = COALESCE($1, username),
         avatar_emoji = COALESCE($2, avatar_emoji)
       WHERE id = $3
       RETURNING id, username, email, avatar_emoji, avatar_url, is_admin`,
      [username || null, avatarEmoji || null, req.auth.userId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Bu kullanıcı adı zaten alınmış.' });
    console.error('DB hatası (PATCH /api/profile/me):', err.message);
    res.status(500).json({ error: 'Güncelleme başarısız.' });
  }
});

app.get('/api/profile/avatars', (req, res) => {
  res.json({ avatars: AVAILABLE_AVATAR_EMOJIS });
});

// Kullanıcı kendi fotoğrafını yükler — DOĞRUDAN canlı olmaz, admin onayı bekler.
// Ayrı bir dosya depolama servisi kurmamak için resim base64 "data URI" olarak
// doğrudan veritabanına yazılıyor; bu yüzden boyutu küçük tutmak ZORUNLU
// (istemci tarafında küçültülüp gönderiliyor, burada da sunucu tarafında
// ekstra bir güvenlik sınırı olarak tekrar kontrol ediliyor).
const MAX_AVATAR_DATA_URL_LENGTH = 350_000; // ~250KB ham veri (base64 şişmesi dahil)
app.post('/api/profile/avatar', authMiddleware, async (req, res) => {
  const { imageDataUrl } = req.body;
  if (!imageDataUrl || typeof imageDataUrl !== 'string' || !imageDataUrl.startsWith('data:image/')) {
    return res.status(400).json({ error: 'Geçersiz resim verisi.' });
  }
  if (imageDataUrl.length > MAX_AVATAR_DATA_URL_LENGTH) {
    return res.status(400).json({ error: 'Resim çok büyük. Lütfen daha küçük bir fotoğraf seç.' });
  }
  try {
    const lockCheck = await pool.query(`SELECT profile_locked FROM users WHERE id = $1`, [req.auth.userId]);
    if (lockCheck.rows[0]?.profile_locked) {
      return res.status(403).json({ error: 'Bir yönetici profilini (ad/fotoğraf) değiştirmeni kilitledi.' });
    }
    await pool.query(
      `UPDATE users SET avatar_pending_url = $1, avatar_status = 'PENDING' WHERE id = $2`,
      [imageDataUrl, req.auth.userId]
    );
    res.json({ ok: true, status: 'PENDING' });
  } catch (err) {
    console.error('DB hatası (POST /api/profile/avatar):', err.message);
    res.status(500).json({ error: 'Yükleme başarısız.' });
  }
});

// ---------- REST: SESLİ SOHBET (AGORA TOKEN ÜRETİMİ) ----------
// Agora projesi "Primary Certificate" etkin olduğu için (güvenli mod), App ID'yi
// token'sız kullanmaya çalışmak "CAN_NOT_GET_GATEWAY_SERVER: dynamic use static key"
// hatası verir. Burada backend, AGORA_APP_CERTIFICATE'i (gizli, sadece sunucuda)
// kullanarak istemci için kısa ömürlü bir RTC token'ı üretir.
// uid = 0 ile üretilen token "wildcard" tokendır: o kanala HANGİ uid ile katılırsa
// katılsın herkes için geçerlidir, bu yüzden gündüz/gece kanalları için tek tek
// oyuncu uid'i eşleştirmemize gerek kalmaz.
app.get('/api/voice/token', authMiddleware, (req, res) => {
  const { channelName } = req.query;
  if (!channelName) return res.status(400).json({ error: 'channelName zorunlu.' });
  if (!process.env.AGORA_APP_ID || !process.env.AGORA_APP_CERTIFICATE) {
    return res.status(503).json({ error: 'Sesli sohbet sunucu tarafında yapılandırılmamış (AGORA_APP_CERTIFICATE eksik).' });
  }
  try {
    const expireSeconds = 6 * 60 * 60; // 6 saat — bir maçtan çok daha uzun
    const token = RtcTokenBuilder.buildTokenWithUid(
      process.env.AGORA_APP_ID,
      process.env.AGORA_APP_CERTIFICATE,
      String(channelName),
      0,
      RtcRole.PUBLISHER,
      expireSeconds,
      expireSeconds
    );
    res.json({ token });
  } catch (err) {
    console.error('Agora token üretim hatası:', err.message);
    res.status(500).json({ error: 'Token üretilemedi.' });
  }
});

// ---------- REST: SİTE GENELİ ADMİN PANELİ ----------
app.get('/api/admin/users', adminMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.username, u.email, u.is_admin, u.is_owner, u.is_banned, u.profile_locked,
              u.avatar_status, u.created_at,
              ps.total_games, ps.total_wins, ps.total_score
       FROM users u
       LEFT JOIN player_stats ps ON ps.user_id = u.id
       ORDER BY u.created_at DESC
       LIMIT 200`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('DB hatası (/api/admin/users):', err.message);
    res.status(500).json({ error: 'Veritabanına bağlanılamadı.' });
  }
});

app.post('/api/admin/users/:userId/ban', adminMiddleware, async (req, res) => {
  const { banned } = req.body;
  try {
    await pool.query(`UPDATE users SET is_banned = $1 WHERE id = $2`, [Boolean(banned), req.params.userId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('DB hatası (POST /api/admin/users/:userId/ban):', err.message);
    res.status(500).json({ error: 'Güncelleme başarısız.' });
  }
});

// Fotoğraf/isim yasağı: kullanıcı kendi profilini (ad + avatar) değiştiremesin.
app.post('/api/admin/users/:userId/profile-lock', adminMiddleware, async (req, res) => {
  const { locked } = req.body;
  try {
    await pool.query(`UPDATE users SET profile_locked = $1 WHERE id = $2`, [Boolean(locked), req.params.userId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('DB hatası (POST /api/admin/users/:userId/profile-lock):', err.message);
    res.status(500).json({ error: 'Güncelleme başarısız.' });
  }
});

// SADECE owner: bir kullanıcıyı admin yapabilir / admin'likten alabilir.
// Owner'ın kendisi bu yoldan değiştirilemez (yanlışlıkla kendi yetkisini
// düşürmesin, ya da başka biri owner'ı admin'likten atamasın).
app.post('/api/admin/users/:userId/promote', ownerMiddleware, async (req, res) => {
  const { isAdmin } = req.body;
  try {
    const target = await pool.query(`SELECT is_owner FROM users WHERE id = $1`, [req.params.userId]);
    if (!target.rows[0]) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
    if (target.rows[0].is_owner) {
      return res.status(400).json({ error: 'Baş yöneticinin admin durumu buradan değiştirilemez.' });
    }
    await pool.query(`UPDATE users SET is_admin = $1 WHERE id = $2`, [Boolean(isAdmin), req.params.userId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('DB hatası (POST /api/admin/users/:userId/promote):', err.message);
    res.status(500).json({ error: 'Güncelleme başarısız.' });
  }
});

// SADECE owner: hesabı KALICI olarak sil. Geçmiş maç kayıtları bozulmasın diye
// game_players/games/game_events/game_votes'taki referanslar NULL'a düşer
// (bkz. schema_v3_migration.sql), sadece kullanıcıya özel veriler (player_stats,
// player_role_stats) CASCADE ile silinir.
app.delete('/api/admin/users/:userId', ownerMiddleware, async (req, res) => {
  try {
    const target = await pool.query(`SELECT is_owner FROM users WHERE id = $1`, [req.params.userId]);
    if (!target.rows[0]) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
    if (target.rows[0].is_owner) return res.status(400).json({ error: 'Baş yönetici hesabı silinemez.' });
    await pool.query(`DELETE FROM users WHERE id = $1`, [req.params.userId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('DB hatası (DELETE /api/admin/users/:userId):', err.message);
    res.status(500).json({ error: 'Silme başarısız.' });
  }
});

// Bekleyen (admin onayı istenen) profil fotoğrafları.
app.get('/api/admin/avatars/pending', adminMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, username, avatar_pending_url, avatar_status
       FROM users WHERE avatar_status = 'PENDING'
       ORDER BY created_at ASC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('DB hatası (/api/admin/avatars/pending):', err.message);
    res.status(500).json({ error: 'Veritabanına bağlanılamadı.' });
  }
});

app.post('/api/admin/avatars/:userId/review', adminMiddleware, async (req, res) => {
  const { approve } = req.body;
  try {
    if (approve) {
      await pool.query(
        `UPDATE users
         SET avatar_url = avatar_pending_url,
             avatar_status = 'APPROVED',
             avatar_pending_url = NULL
         WHERE id = $1`,
        [req.params.userId]
      );
    } else {
      await pool.query(
        `UPDATE users SET avatar_status = 'REJECTED', avatar_pending_url = NULL WHERE id = $1`,
        [req.params.userId]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('DB hatası (POST /api/admin/avatars/:userId/review):', err.message);
    res.status(500).json({ error: 'İşlem başarısız.' });
  }
});

// Canlı (RAM'deki) odaların anlık listesi. Not: `activeRooms` bu satırın altında
// tanımlanıyor ama sorun değil — bu callback ancak gerçek bir istek geldiğinde
// çalışır, o noktada modül tamamen yüklenmiş ve activeRooms hazır olur.
app.get('/api/admin/rooms', adminMiddleware, (req, res) => {
  res.json([...activeRooms.values()].map((room) => room.getAdminSummary()));
});

app.post('/api/admin/rooms/:roomCode/end', adminMiddleware, (req, res) => {
  const room = activeRooms.get(req.params.roomCode);
  if (!room) return res.status(404).json({ error: 'Oda bulunamadı.' });
  if (room.phase === PHASE.LOBBY) {
    activeRooms.delete(req.params.roomCode);
    io.to(req.params.roomCode).emit('roomClosedByAdmin');
  } else {
    room.abortGame(room.hostUserId); // host adına zorla sıfırla
    io.to(req.params.roomCode).emit('roomUpdate', room.getPublicState());
    io.to(req.params.roomCode).emit('adminEndedGame');
  }
  res.json({ ok: true });
});

// ---------- HTTP + SOCKET.IO KURULUMU ----------
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// roomCode -> GameRoom instance (RAM'de tutulan aktif maçlar)
const activeRooms = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // karışan karakterler çıkarıldı (0/O, 1/I)
  let code;
  do {
    code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (activeRooms.has(code));
  return code;
}

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    const decoded = jwt.verify(token, JWT_SECRET); // { userId, username }
    // Kullanıcı adını/avatarını JWT'deki (girişteki) haliyle değil, DB'deki
    // GÜNCEL haliyle kullan — profilini düzenlediyse oyun içinde eski adı
    // görünmesin. Aynı sorguda ban durumu ve admin yetkisi de kontrol edilir
    // (admin yetkisi burada okunuyor ki "oda dolu olsa da gizlice izleme"
    // özelliği için istemciye güvenmeden sunucu tarafında doğrulayabilelim).
    const result = await pool.query(
      `SELECT username, avatar_emoji, avatar_url, is_banned, is_admin FROM users WHERE id = $1`,
      [decoded.userId]
    );
    const row = result.rows[0];
    if (!row || row.is_banned) return next(new Error('unauthorized'));
    socket.user = {
      userId: decoded.userId,
      username: row.username,
      avatarEmoji: row.avatar_emoji,
      avatarUrl: row.avatar_url,
      isAdmin: row.is_admin,
    };
    next();
  } catch {
    next(new Error('unauthorized'));
  }
});

io.on('connection', (socket) => {
  const { userId, username, avatarEmoji, avatarUrl, isAdmin } = socket.user;

  // ---- LOBİ ----
  socket.on('createRoom', ({ roomSize } = {}) => {
    const size = SUPPORTED_ROOM_SIZES.includes(roomSize) ? roomSize : 8;
    const roomCode = generateRoomCode();
    const room = new GameRoom(roomCode, io, size, (finishedRoom) => {
      persistGameResult(finishedRoom).catch((err) => console.error('persistGameResult hata:', err));
    });
    activeRooms.set(roomCode, room);
    room.addPlayer(userId, username, socket.id, avatarEmoji, avatarUrl);
    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    io.to(roomCode).emit('roomUpdate', room.getPublicState());
  });

  socket.on('joinRoom', ({ roomCode }) => {
    const room = activeRooms.get(roomCode);
    if (!room) return socket.emit('error', { message: 'Oda bulunamadı.' });
    // ÖNEMLİ: Oyun başladıktan sonra YENİ bir oyuncunun katılmasını engelliyoruz,
    // ama zaten bu odada rolü olan bir oyuncunun (sayfa yenileme, bağlantı kopması,
    // sekme kapat-aç) YENİDEN katılmasına İZİN VERMELİYİZ — aksi halde oyuncunun
    // socketId'si bayatlar ve sunucudan ona özel gönderilen her şey (Baş Casus'un
    // sorgu sonucu, Gölge Lider'in "Gubiş mi?" cevabı, rol bilgisi vb.) sonsuza
    // kadar boşluğa gider. Bu, "bazı roller çalışmıyor" şikayetinin gerçek nedeniydi.
    const isExistingPlayer = room.players.some((p) => p.userId === userId);
    if (room.phase !== PHASE.LOBBY && !isExistingPlayer) {
      return socket.emit('error', { message: 'Oyun zaten başladı.' });
    }
    try {
      room.addPlayer(userId, username, socket.id, avatarEmoji, avatarUrl);
      socket.join(roomCode);
      socket.data.roomCode = roomCode;
      io.to(roomCode).emit('roomUpdate', room.getPublicState());

      // Reconnect: oyuncuya kendi rolünü ve mevcut fazı tekrar gönder,
      // aksi halde sayfa yenilendiğinde ekranı "rolsüz" kalır.
      if (room.phase !== PHASE.LOBBY) {
        const player = room.players.find((p) => p.userId === userId);
        if (player?.role) {
          socket.emit('gameStarted', { yourRole: player.role, team: player.team });
        }
        socket.emit('phaseChanged', { phase: room.phase, dayNumber: room.dayNumber });
      }
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  });

  // ---- YÖNETİCİ: oda dolu olsa/oyun başlamış olsa bile GİZLİCE izleme ----
  // Sadece is_admin=true hesaplar kullanabilir (server tarafında doğrulanır,
  // istemci beyanına güvenilmez). Admin, koltuk almaz — players listesine
  // eklenmez, oda kapasitesini etkilemez, kimseye görünmez. Sadece herkesin
  // gördüğü genel yayınları (oturma düzeni, faz, ölümler, gündüz sohbeti) alır;
  // oyuncuların özel gece aksiyonu sonuçlarını GÖRMEZ.
  socket.on('adminSpectateRoom', ({ roomCode }) => {
    if (!isAdmin) return socket.emit('error', { message: 'Yetkisiz.' });
    const room = activeRooms.get(roomCode);
    if (!room) return socket.emit('error', { message: 'Oda bulunamadı.' });
    socket.join(roomCode);
    socket.data.spectateRoomCode = roomCode;
    socket.emit('roomUpdate', room.getPublicState());
    socket.emit('phaseChanged', { phase: room.phase, dayNumber: room.dayNumber });
    socket.emit('adminSpectateJoined', { roomCode });
  });

  socket.on('adminLeaveSpectate', () => {
    if (socket.data.spectateRoomCode) {
      socket.leave(socket.data.spectateRoomCode);
      socket.data.spectateRoomCode = null;
    }
  });

  socket.on('leaveRoom', () => {
    const room = activeRooms.get(socket.data.roomCode);
    if (!room) return;
    room.removePlayer(userId);
    socket.leave(socket.data.roomCode);
    io.to(socket.data.roomCode).emit('roomUpdate', room.getPublicState());
    if (room.players.length === 0) activeRooms.delete(socket.data.roomCode);
  });

  // ---- HOST KONTROLLERİ ----
  socket.on('kickPlayer', ({ targetUserId }) => {
    const room = activeRooms.get(socket.data.roomCode);
    if (!room) return;
    const result = room.kickPlayer(userId, targetUserId);
    if (!result.ok) return socket.emit('error', { message: result.reason });
    if (result.kickedSocketId) {
      io.sockets.sockets.get(result.kickedSocketId)?.emit('kickedFromRoom');
      io.sockets.sockets.get(result.kickedSocketId)?.leave(socket.data.roomCode);
    }
    io.to(socket.data.roomCode).emit('roomUpdate', room.getPublicState());
  });

  socket.on('abortGame', () => {
    const room = activeRooms.get(socket.data.roomCode);
    if (!room) return;
    const result = room.abortGame(userId);
    if (!result.ok) return socket.emit('error', { message: result.reason });
    io.to(socket.data.roomCode).emit('roomUpdate', room.getPublicState());
  });

  // ---- HAZIRIM (ilk başlangıç ve tur sonrası devam için) ----
  socket.on('setReady', ({ isReady } = {}) => {
    const room = activeRooms.get(socket.data.roomCode);
    if (!room) return;
    const result = room.setReady(userId, isReady);
    if (!result.ok) return socket.emit('error', { message: result.reason });
    io.to(socket.data.roomCode).emit('roomUpdate', room.getPublicState());
    if (result.newRoundStarted) {
      io.to(socket.data.roomCode).emit('voicePhaseChanged', { phase: 'NIGHT' });
    }
  });

  socket.on('startGame', () => {
    const room = activeRooms.get(socket.data.roomCode);
    if (!room) return;
    if (room.hostUserId !== userId) return socket.emit('error', { message: 'Sadece oda kurucusu başlatabilir.' });
    try {
      room.startGame();
      // Sesli sohbet: gece fazına girildiği için tüm istemcilere "night" kanal bilgisini yolla.
      // (Detaylı entegrasyon: docs/MIMARI-PLAN.md > Sesli İletişim bölümü)
      io.to(socket.data.roomCode).emit('voicePhaseChanged', { phase: 'NIGHT' });
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  });

  // ---- GECE YETENEKLERİ ----
  socket.on('useAbility', ({ abilityKey, targetUserId, mode }) => {
    const room = activeRooms.get(socket.data.roomCode);
    if (!room) return;
    const result =
      abilityKey === 'DOCTOR_ANTIDOTE_OR_POISON'
        ? room.submitDoctorAction(userId, mode, targetUserId)
        : abilityKey === 'QUERY_IS_PRINCESS'
        ? room.submitShadowLeaderQuery(userId, targetUserId)
        : room.submitNightAction(userId, abilityKey, targetUserId);
    if (!result.ok) socket.emit('error', { message: result.reason });
  });

  // ---- GÜNDÜZ OYLAMA ----
  socket.on('castVote', ({ targetUserId }) => {
    const room = activeRooms.get(socket.data.roomCode);
    if (!room) return;
    const result = room.castVote(userId, targetUserId);
    if (!result.ok) socket.emit('error', { message: result.reason });
  });

  // ---- GİZLİ PRENSES KART AÇMA ----
  socket.on('claimPrincess', () => {
    const room = activeRooms.get(socket.data.roomCode);
    if (!room) return;
    const result = room.claimPrincess(userId);
    if (!result.ok) socket.emit('error', { message: result.reason });
  });

  // ---- YAZILI SOHBET ----
  socket.on('sendChatMessage', ({ text }) => {
    const room = activeRooms.get(socket.data.roomCode);
    if (!room) return;
    const result = room.sendChatMessage(userId, username, text);
    if (!result.ok) socket.emit('error', { message: result.reason });
  });

  // ---- BAĞLANTI KOPMASI ----
  socket.on('disconnect', () => {
    const room = activeRooms.get(socket.data.roomCode);
    if (!room) return;
    // Not: Oyun ortasında disconnect'i "ölüm" saymak yerine burada sadece
    // socketId'yi geçersizleştirip yeniden bağlanma (reconnect) desteği eklenebilir.
  });

  // ---- SES FAZ GEÇİŞİ TAKİBİ (gameRoom faz değişince otomatik tetiklenir) ----
  // gameRoom._broadcastPhase() her faz değişiminde 'phaseChanged' event'i yayınlar;
  // frontend bu event'i dinleyip WebRTC/Agora tarafında mute/kanal geçişini yapar.
});

// Maç bittiğinde (GameRoom._endGame içinde çağrılabilir) sonuçları DB'ye yaz.
async function persistGameResult(gameRoom) {
  const scores = calculateMatchScores(gameRoom);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const gameResult = await client.query(
      `INSERT INTO games (room_code, host_user_id, status, winner_team, started_at, ended_at)
       VALUES ($1,$2,'FINISHED',$3, now(), now()) RETURNING id`,
      [gameRoom.roomCode, gameRoom.hostUserId, gameRoom.winner]
    );
    const gameId = gameResult.rows[0].id;

    for (let i = 0; i < scores.length; i++) {
      const scoreEntry = scores[i];
      const player = gameRoom.players.find((p) => p.userId === scoreEntry.userId);
      // seat_number burada gerçek oturma sırasını değil, sadece game_players
      // tablosundaki UNIQUE(game_id, seat_number) kısıtını karşılayan benzersiz
      // bir indeks olarak kullanılıyor.
      await client.query(
        `INSERT INTO game_players (game_id, user_id, seat_number, role_key, is_alive, died_on_day, died_cause, score_delta)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          gameId,
          scoreEntry.userId,
          i,
          scoreEntry.role,
          Boolean(player?.isAlive),
          player?.diedOnDay ?? null,
          player?.diedCause ?? null,
          scoreEntry.points,
        ]
      );

      // Genel istatistikler: kazanma/kaybetme sayısı ve galibiyet serisi artık
      // gerçekten güncelleniyor (önceden sadece total_games/total_score işleniyordu).
      if (scoreEntry.isWinner) {
        await client.query(
          `UPDATE player_stats
           SET total_games = total_games + 1,
               total_score = total_score + $2,
               total_wins = total_wins + 1,
               current_win_streak = current_win_streak + 1,
               best_win_streak = GREATEST(best_win_streak, current_win_streak + 1),
               updated_at = now()
           WHERE user_id = $1`,
          [scoreEntry.userId, scoreEntry.points]
        );
      } else {
        await client.query(
          `UPDATE player_stats
           SET total_games = total_games + 1,
               total_score = total_score + $2,
               total_losses = total_losses + 1,
               current_win_streak = 0,
               updated_at = now()
           WHERE user_id = $1`,
          [scoreEntry.userId, scoreEntry.points]
        );
      }

      // Rol bazlı istatistik: "rollere göre en çok kazananlar" sıralaması bu tablodan gelir.
      await client.query(
        `INSERT INTO player_role_stats (user_id, role_key, games_played, wins)
         VALUES ($1, $2, 1, $3)
         ON CONFLICT (user_id, role_key)
         DO UPDATE SET games_played = player_role_stats.games_played + 1,
                       wins = player_role_stats.wins + EXCLUDED.wins`,
        [scoreEntry.userId, scoreEntry.role, scoreEntry.isWinner ? 1 : 0]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('persistGameResult hata:', err);
  } finally {
    client.release();
  }
}

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`Sarayda Gece backend ${PORT} portunda çalışıyor.`));

module.exports = { app, server, io, activeRooms };
