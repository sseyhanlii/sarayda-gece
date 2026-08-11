'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSocket } from '../../lib/socket';
import { getUser, isLoggedIn } from '../../lib/auth';
import { ROOM_SIZES, ROOM_SIZE_ROLE_SETS, ROLE_LABELS, ROOM_SIZE_NAMES } from '../../lib/roles';
import { fetchPublicSettings } from '../../lib/api';
import NavBar from '../../components/NavBar';

export default function LobbyPage() {
  const router = useRouter();
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [roomSize, setRoomSize] = useState(8);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Oda isimleri ve rol dağılımları artık admin panelinden istenildiği zaman
  // değiştirilebiliyor — bu yüzden sabit lib/roles.js değerlerini SADECE
  // yedek (backend'e erişilemezse) olarak kullanıyoruz, asıl güncel veriyi
  // sunucudan çekiyoruz.
  const [roomNames, setRoomNames] = useState(ROOM_SIZE_NAMES);
  const [roleSets, setRoleSets] = useState(ROOM_SIZE_ROLE_SETS);
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

    socket.on('roomUpdate', handleRoomUpdate);
    socket.on('error', handleError);

    return () => {
      socket.off('roomUpdate', handleRoomUpdate);
      socket.off('error', handleError);
    };
  }, [router]);

  function handleCreateRoom() {
    setError('');
    setBusy(true);
    getSocket().emit('createRoom', { roomSize });
  }

  function handleJoinRoom(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    getSocket().emit('joinRoom', { roomCode: roomCodeInput.trim().toUpperCase() });
  }

  return (
    <div>
      <NavBar />
      <div className="page">
        <h1>Sarayda Gece</h1>
        <p className="subtitle">Hoş geldin, {user?.username || '...'}</p>

        {error && <div className="error-banner">{error}</div>}

        <div className="card">
          <h3>Yeni oda kur</h3>
          <div className="field">
            <label>Oda boyutu</label>
            <select value={roomSize} onChange={(e) => setRoomSize(Number(e.target.value))}>
              {ROOM_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size} kişilik — {roomNames[size]}
                </option>
              ))}
            </select>
          </div>
          <p className="small">
            <strong>{roomNames[roomSize]}</strong>'nde oynanacak roller:{' '}
            {(roleSets[roomSize] || []).map((key) => ROLE_LABELS[key]).join(', ')}
          </p>
          <button onClick={handleCreateRoom} disabled={busy} style={{ width: '100%', marginTop: 8 }}>
            Oda Oluştur
          </button>
        </div>

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
      </div>
    </div>
  );
}
