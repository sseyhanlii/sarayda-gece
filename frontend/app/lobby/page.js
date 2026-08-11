'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSocket } from '../../lib/socket';
import { getUser, isLoggedIn, clearSession } from '../../lib/auth';

export default function LobbyPage() {
  const router = useRouter();
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const user = getUser();

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace('/login');
      return;
    }

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
    getSocket().emit('createRoom');
  }

  function handleJoinRoom(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    getSocket().emit('joinRoom', { roomCode: roomCodeInput.trim().toUpperCase() });
  }

  function handleLogout() {
    clearSession();
    router.push('/login');
  }

  return (
    <div className="page">
      <h1>Sarayda Gece</h1>
      <p className="subtitle">Hoş geldin, {user?.username || '...'}</p>

      {error && <div className="error-banner">{error}</div>}

      <div className="card">
        <h3>Yeni oda kur</h3>
        <p className="small">8 kişilik bir oda açar, arkadaşlarına vereceğin bir davet kodu üretilir.</p>
        <button onClick={handleCreateRoom} disabled={busy} style={{ width: '100%' }}>
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

      <p className="link-row">
        <a href="#" onClick={handleLogout}>Çıkış yap</a>
      </p>
    </div>
  );
}
