'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchAdminUsers, setUserBanned, fetchAdminRooms, endRoomAsAdmin } from '../../lib/api';
import { getToken, getUser, isLoggedIn } from '../../lib/auth';
import NavBar from '../../components/NavBar';

export default function AdminPage() {
  const router = useRouter();
  const user = getUser();
  const [tab, setTab] = useState('users');
  const [users, setUsers] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace('/login');
      return;
    }
    if (!user?.isAdmin) {
      // Sunucu zaten reddeder ama kullanıcıyı boş bir 403 sayfasında bırakmamak için
      // client tarafında da erkenden yönlendiriyoruz.
      router.replace('/lobby');
      return;
    }
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  function loadAll() {
    setLoading(true);
    const token = getToken();
    Promise.all([fetchAdminUsers(token), fetchAdminRooms(token)])
      .then(([usersData, roomsData]) => {
        setUsers(usersData);
        setRooms(roomsData);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  async function toggleBan(u) {
    try {
      await setUserBanned(getToken(), u.id, !u.is_banned);
      loadAll();
    } catch (err) {
      setError(err.message);
    }
  }

  async function endRoom(roomCode) {
    if (!confirm(`${roomCode} kodlu odayı sonlandırmak istediğine emin misin?`)) return;
    try {
      await endRoomAsAdmin(getToken(), roomCode);
      loadAll();
    } catch (err) {
      setError(err.message);
    }
  }

  if (!user?.isAdmin) return null;

  return (
    <div>
      <NavBar />
      <div className="page">
        <h1>Yönetici Paneli</h1>
        {error && <div className="error-banner">{error}</div>}

        <div className="row" style={{ marginBottom: 16 }}>
          <button className={tab === 'users' ? '' : 'secondary'} onClick={() => setTab('users')}>
            Kullanıcılar ({users.length})
          </button>
          <button className={tab === 'rooms' ? '' : 'secondary'} onClick={() => setTab('rooms')}>
            Canlı Odalar ({rooms.length})
          </button>
          <button className="secondary" onClick={loadAll}>
            Yenile
          </button>
        </div>

        {loading ? (
          <p className="center small">Yükleniyor...</p>
        ) : tab === 'users' ? (
          <div className="card">
            <ul className="player-list">
              {users.map((u) => (
                <li key={u.id}>
                  <span>
                    {u.username} <span className="small">({u.email})</span> —{' '}
                    <span className="small">
                      {u.total_wins || 0}/{u.total_games || 0} galibiyet, {u.total_score || 0} puan
                    </span>
                    {u.is_admin && <span className="badge" style={{ marginLeft: 6 }}>admin</span>}
                    {u.is_banned && <span className="badge" style={{ marginLeft: 6, background: 'var(--danger)' }}>yasaklı</span>}
                  </span>
                  <button className={u.is_banned ? 'secondary' : 'danger'} onClick={() => toggleBan(u)}>
                    {u.is_banned ? 'Yasağı Kaldır' : 'Yasakla'}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="card">
            {rooms.length === 0 ? (
              <p className="small center">Şu anda aktif oda yok.</p>
            ) : (
              <ul className="player-list">
                {rooms.map((r) => (
                  <li key={r.roomCode}>
                    <span>
                      <strong>{r.roomCode}</strong> — {r.roomSize} kişilik, {r.playerCount} oyuncu,{' '}
                      <span className="small">faz: {r.phase}</span>
                    </span>
                    <button className="danger" onClick={() => endRoom(r.roomCode)}>
                      Sonlandır
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
