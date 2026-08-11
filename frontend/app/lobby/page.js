'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSocket } from '../../lib/socket';
import { getUser, isLoggedIn } from '../../lib/auth';
import { ROOM_SIZES, ROOM_SIZE_ROLE_SETS, ROLE_LABELS, ROOM_SIZE_NAMES } from '../../lib/roles';
import { fetchPublicSettings } from '../../lib/api';
import NavBar from '../../components/NavBar';

const PHASE_LABELS = {
  LOBBY: 'Bekleniyor',
  NIGHT: 'Oyunda (gece)',
  DAY_DISCUSSION: 'Oyunda (gündüz)',
  DAY_VOTE: 'Oyunda (oylama)',
  PENDING_EXECUTION: 'Oyunda (sonuç)',
  RESULTS: 'Sonuçlanıyor',
};

export default function LobbyPage() {
  const router = useRouter();
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Oda isimleri ve rol dağılımları artık admin panelinden istenildiği zaman
  // değiştirilebiliyor — bu yüzden sabit lib/roles.js değerlerini SADECE
  // yedek (backend'e erişilemezse) olarak kullanıyoruz, asıl güncel veriyi
  // sunucudan çekiyoruz.
  const [roomNames, setRoomNames] = useState(ROOM_SIZE_NAMES);
  const [roleSets, setRoleSets] = useState(ROOM_SIZE_ROLE_SETS);
  // Şu an aktif (RAM'deki) odaların anlık listesi — oda boyutuna göre gruplu.
  // Sunucu her oda değişikliğinde (katılma/ayrılma/başlama/bitme) bunu
  // kendiliğinden yayınlar, biz burada sadece dinleyip diziyoruz.
  const [lobbyRooms, setLobbyRooms] = useState([]);
  const user = getUser();

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace('/login');
      return;
    }

    fetchPublicSettings()
      .then((s) => {
        if (s.roomNames) setRoomNames(s.roomNames);
        if (s.roleSets) setRoleSets(s.roleSets);
      })
      .catch(() => {}); // backend'e erişilemezse yedek değerlerle devam et

    const socket = getSocket();

    function handleRoomUpdate(state) {
      // Odaya katılma/oluşturma başarılıysa oda sayfasına geç
      router.push(`/room/${state.roomCode}`);
    }
    function handleError(payload) {
      setBusy(false);
      setError(payload.message);
    }
    function handleLobbyRooms(rooms) {
      setLobbyRooms(rooms || []);
    }

    socket.on('roomUpdate', handleRoomUpdate);
    socket.on('error', handleError);
    socket.on('lobbyRoomsUpdate', handleLobbyRooms);
    // Sayfa açılır açılmaz mevcut listeyi iste — bundan sonrası zaten anlık gelir.
    socket.emit('requestLobbyRooms');

    return () => {
      socket.off('roomUpdate', handleRoomUpdate);
      socket.off('error', handleError);
      socket.off('lobbyRoomsUpdate', handleLobbyRooms);
    };
  }, [router]);

  function handleCreateRoom(size) {
    setError('');
    setBusy(true);
    getSocket().emit('createRoom', { roomSize: size });
  }

  function handleJoinRoomByCode(code) {
    setError('');
    setBusy(true);
    getSocket().emit('joinRoom', { roomCode: code.trim().toUpperCase() });
  }

  function handleJoinRoom(e) {
    e.preventDefault();
    handleJoinRoomByCode(roomCodeInput);
  }

  return (
    <div>
      <NavBar />
      <div className="page">
        <h1>Sarayda Gece</h1>
        <p className="subtitle">Hoş geldin, {user?.username || '...'}</p>

        {error && <div className="error-banner">{error}</div>}

        <div className="card">
          <h3>Davet koduyla katıl</h3>
          <form onSubmit={handleJoinRoom}>
            <div className="field">
              <label htmlFor="roomCode">Oda kodu</label>
              <input
                id="roomCode"
                value={roomCodeInput}
                onChange={(e) => setRoomCodeInput(e.target.value)}
                placeholder="örn. X7K9P2"
                maxLength={6}
                required
              />
            </div>
            <button type="submit" disabled={busy} style={{ width: '100%' }}>
              Odaya Katıl
            </button>
          </form>
        </div>

        <p className="small center" style={{ marginTop: 24, marginBottom: 8 }}>
          Aşağıda şu anda açık olan odalar anlık olarak listelenir — boyut seçip
          direkt katılabilir ya da o boyutta yeni bir oda kurabilirsin.
        </p>

        {ROOM_SIZES.map((size) => {
          const roomsOfSize = lobbyRooms.filter((r) => r.roomSize === size);
          return (
            <div className="card" key={size}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div>
                  <h3 style={{ margin: '0 0 4px' }}>
                    {size} Kişilik — {roomNames[size]}
                  </h3>
                  <p className="small" style={{ margin: 0 }}>
                    Roller: {(roleSets[size] || []).map((key) => ROLE_LABELS[key]).join(', ')}
                  </p>
                </div>
                <button onClick={() => handleCreateRoom(size)} disabled={busy}>
                  + Oda Oluştur
                </button>
              </div>

              {roomsOfSize.length === 0 ? (
                <p className="small center" style={{ marginTop: 14 }}>
                  Bu boyutta şu an açık oda yok — ilk odayı sen kur!
                </p>
              ) : (
                <ul className="player-list" style={{ marginTop: 14 }}>
                  {roomsOfSize.map((r) => (
                    <li key={r.roomCode}>
                      <span>
                        <strong>{r.roomName || r.roomCode}</strong>{' '}
                        <span className="small">
                          ({r.hostUsername ? `kurucu: ${r.hostUsername}, ` : ''}
                          {r.playerCount}/{r.roomSize})
                        </span>
                      </span>
                      <span className="row" style={{ gap: 8, alignItems: 'center' }}>
                        <span className="badge">{PHASE_LABELS[r.phase] || r.phase}</span>
                        <button
                          className={r.isJoinable ? '' : 'secondary'}
                          disabled={busy || !r.isJoinable}
                          onClick={() => handleJoinRoomByCode(r.roomCode)}
                          style={{ padding: '6px 14px', fontSize: '0.8rem' }}
                        >
                          {r.isJoinable ? 'Katıl' : 'Dolu/Oyunda'}
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
