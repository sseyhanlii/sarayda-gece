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

const { GameRoom, PHASE } = require('./game/gameRoom');
const { calculateMatchScores } = require('./game/scoring');

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
      `INSERT INTO users (username, email, password_hash) VALUES ($1,$2,$3) RETURNING id, username, email`,
      [username, email, passwordHash]
    );
    const user = result.rows[0];
    await pool.query(`INSERT INTO player_stats (user_id) VALUES ($1)`, [user.id]);
    const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user });
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
  const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id: user.id, username: user.username, email: user.email } });
});

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.replace('Bearer ', '');
  try {
    req.auth = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Geçersiz oturum.' });
  }
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

io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    socket.user = jwt.verify(token, JWT_SECRET); // { userId, username }
    next();
  } catch {
    next(new Error('unauthorized'));
  }
});

io.on('connection', (socket) => {
  const { userId, username } = socket.user;

  // ---- LOBİ ----
  socket.on('createRoom', () => {
    const roomCode = generateRoomCode();
    const room = new GameRoom(roomCode, io);
    activeRooms.set(roomCode, room);
    room.addPlayer(userId, username, socket.id);
    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    io.to(roomCode).emit('roomUpdate', room.getPublicState());
  });

  socket.on('joinRoom', ({ roomCode }) => {
    const room = activeRooms.get(roomCode);
    if (!room) return socket.emit('error', { message: 'Oda bulunamadı.' });
    if (room.phase !== PHASE.LOBBY) return socket.emit('error', { message: 'Oyun zaten başladı.' });
    try {
      room.addPlayer(userId, username, socket.id);
      socket.join(roomCode);
      socket.data.roomCode = roomCode;
      io.to(roomCode).emit('roomUpdate', room.getPublicState());
    } catch (err) {
      socket.emit('error', { message: err.message });
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

    for (const scoreEntry of scores) {
      await client.query(
        `INSERT INTO game_players (game_id, user_id, seat_number, role_key, is_alive, score_delta)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [gameId, scoreEntry.userId, 0, scoreEntry.role, true, scoreEntry.points]
      );
      await client.query(
        `UPDATE player_stats
         SET total_games = total_games + 1,
             total_score = total_score + $2,
             updated_at = now()
         WHERE user_id = $1`,
        [scoreEntry.userId, scoreEntry.points]
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
