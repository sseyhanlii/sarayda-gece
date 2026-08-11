'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  fetchAdminUsers,
  setUserBanned,
  fetchAdminRooms,
  endRoomAsAdmin,
  fetchMyProfile,
  setProfileLock,
  promoteToAdmin,
  deleteUserAccount,
  fetchPendingAvatars,
  reviewAvatar,
} from '../../lib/api';
import { getToken, getUser, isLoggedIn } from '../../lib/auth';
import NavBar from '../../components/NavBar';

export default function AdminPage() {
  const router = useRouter();
  const user = getUser();
  const [tab, setTab] = useState('users');
  const [users, setUsers] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [pendingAvatars, setPendingAvatars] = useState([]);
  const [isOwner, setIsOwner] = useState(false);
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
    Promise.all([fetchAdminUsers(token), fetchAdminRooms(token), fetchPendingAvatars(token), fetchMyProfile(token)])
      .then(([usersData, roomsData, avatarsData, myProfile]) => {
        setUsers(usersData);
        setRooms(roomsData);
        setPendingAvatars(avatarsData);
        setIsOwner(Boolean(myProfile.is_owner));
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

  async function toggleLock(u) {
    try {
      await setProfileLock(getToken(), u.id, !u.profile_locked);
      loadAll();
    } catch (err) {
      setError(err.message);
    }
  }

  async function togglePromote(u) {
    const verb = u.is_admin ? 'admin yetkisini geri almak' : 'admin yapmak';
    if (!confirm(`${u.username} kullanıcısını ${verb} istediğine emin misin?`)) return;
    try {
      await promoteToAdmin(getToken(), u.id, !u.is_admin);
      loadAll();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete(u) {
    if (!confirm(`${u.username} hesabını KALICI olarak silmek istediğine emin misin? Bu geri alınamaz.`)) return;
    try {
      await deleteUserAccount(getToken(), u.id);
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

  async function handleAvatarReview(u, approve) {
    try {
      await reviewAvatar(getToken(), u.id, approve);
      loadAll();
    } catch (err) {
      setError(err.message);
    }
  }

  function spectateRoom(roomCode) {
    window.open(`/room/${roomCode}?spectate=1`, '_blank');
  }

  if (!user?.isAdmin) return null;

  return (
    <div>
      <NavBar />
      <div className="page">
        <h1>Yönetici Paneli</h1>
        {error && <div className="error-banner">{error}</div>}

        <div className="row" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
          <button className={tab === 'users' ? '' : 'secondary'} onClick={() => setTab('users')}>
            Kullanıcılar ({users.length})
          </button>
          <button className={tab === 'rooms' ? '' : 'secondary'} onClick={() => setTab('rooms')}>
            Canlı Odalar ({rooms.length})
          </button>
          <button className={tab === 'avatars' ? '' : 'secondary'} onClick={() => setTab('avatars')}>
            Fotoğraf Onayı ({pendingAvatars.length})
          </button>
          <button className="secondary" onClick={loadAll}>
            Yenile
          </button>
        </div>

        {loading ? (
          <p className="center small">Yükleniyor...</p>
        ) : tab === 'users' ? (
          <div className="card" style={{ overflowX: 'auto' }}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Kullanıcı</th>
                  <th>İstatistik</th>
                  <th>Durum</th>
                  <th>İşlemler</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      {u.username}
                      <div className="small">{u.email}</div>
                    </td>
                    <td className="small">
                      {u.total_wins || 0}/{u.total_games || 0} galibiyet
                      <div>{u.total_score || 0} puan</div>
                    </td>
                    <td>
                      {u.is_owner && <span className="badge owner-badge" style={{ marginRight: 4 }}>owner</span>}
                      {u.is_admin && !u.is_owner && <span className="badge" style={{ marginRight: 4 }}>admin</span>}
                      {u.is_banned && <span className="badge" style={{ marginRight: 4, background: 'var(--danger)', color: '#fff' }}>yasaklı</span>}
                      {u.profile_locked && <span className="badge" style={{ marginRight: 4 }}>profil kilitli</span>}
                    </td>
                    <td>
                      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                        <button className={u.is_banned ? 'secondary' : 'danger'} onClick={() => toggleBan(u)}>
                          {u.is_banned ? 'Yasağı Kaldır' : 'Yasakla'}
                        </button>
                        <button className="secondary" onClick={() => toggleLock(u)}>
                          {u.profile_locked ? 'Kilidi Aç' : 'Ad/Foto Kilitle'}
                        </button>
                        {isOwner && !u.is_owner && (
                          <>
                            <button className="secondary" onClick={() => togglePromote(u)}>
                              {u.is_admin ? 'Adminlikten Al' : 'Admin Yap'}
                            </button>
                            <button className="danger" onClick={() => handleDelete(u)}>
                              Hesabı Sil
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!isOwner && (
              <p className="small" style={{ marginTop: 10 }}>
                Not: Admin atama ve hesap silme sadece baş yöneticide (owner) açık — senin yetkilerin sınırlı.
              </p>
            )}
          </div>
        ) : tab === 'rooms' ? (
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
                    <div className="row">
                      <button className="secondary" onClick={() => spectateRoom(r.roomCode)}>
                        🕵️ Gizlice İzle
                      </button>
                      <button className="danger" onClick={() => endRoom(r.roomCode)}>
                        Sonlandır
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="card">
            {pendingAvatars.length === 0 ? (
              <p className="small center">Onay bekleyen fotoğraf yok.</p>
            ) : (
              <ul className="player-list">
                {pendingAvatars.map((u) => (
                  <li key={u.id}>
                    <span className="row" style={{ alignItems: 'center', gap: 10 }}>
                      <img src={u.avatar_pending_url} alt={u.username} className="avatar-preview" style={{ width: 48, height: 48, margin: 0 }} />
                      {u.username}
                    </span>
                    <div className="row">
                      <button onClick={() => handleAvatarReview(u, true)}>Onayla</button>
                      <button className="danger" onClick={() => handleAvatarReview(u, false)}>
                        Reddet
                      </button>
                    </div>
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
