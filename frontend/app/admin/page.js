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
  fetchAdminSettings,
  updateAdminSettings,
  updateAdminPermissions,
  addBotToRoom,
} from '../../lib/api';
import { getToken, getUser, isLoggedIn } from '../../lib/auth';
import { ADMIN_PERMISSION_LABELS, ALL_ROLE_KEYS, ROLE_LABELS } from '../../lib/roles';
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
    Promise.all([
      fetchAdminUsers(token),
      fetchAdminRooms(token),
      fetchPendingAvatars(token).catch(() => []),
      fetchMyProfile(token),
    ])
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

  async function handlePermissionToggle(u, key) {
    const current = u.admin_permissions || {};
    const next = { ...current, [key]: !current[key] };
    try {
      await updateAdminPermissions(getToken(), u.id, next);
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

  async function handleAddBot(roomCode) {
    try {
      await addBotToRoom(getToken(), roomCode);
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
          <button className={tab === 'settings' ? '' : 'secondary'} onClick={() => setTab('settings')}>
            ⚙️ Oyun Ayarları
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
                      {isOwner && u.is_admin && !u.is_owner && (
                        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--accent-soft)' }}>
                          <p className="small" style={{ margin: '0 0 4px' }}>Bu admin'in yetkileri:</p>
                          {Object.keys(ADMIN_PERMISSION_LABELS).map((key) => (
                            <label key={key} className="small" style={{ display: 'block', marginBottom: 2, cursor: 'pointer' }}>
                              <input
                                type="checkbox"
                                checked={Boolean(u.admin_permissions?.[key])}
                                onChange={() => handlePermissionToggle(u, key)}
                                style={{ marginRight: 6 }}
                              />
                              {ADMIN_PERMISSION_LABELS[key]}
                            </label>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!isOwner && (
              <p className="small" style={{ marginTop: 10 }}>
                Not: Admin atama ve hesap silme (izin verilmedikçe) sadece baş yöneticide (owner) açık.
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
                    <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                      {r.phase === 'LOBBY' && r.playerCount < r.roomSize && (
                        <button className="secondary" onClick={() => handleAddBot(r.roomCode)}>
                          🤖 Bot Ekle
                        </button>
                      )}
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
        ) : tab === 'avatars' ? (
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
        ) : (
          <GameSettingsPanel onError={setError} />
        )}
      </div>
    </div>
  );
}

// Oyun ayarları paneli: gece/gündüz/oylama süresi, oda isimleri, ve her oda
// boyutu için hangi rollerin oynanacağı — istenildiği zaman değiştirilebilir,
// kaydedilince anında (yeniden deploy gerekmeden) yeni odalara uygulanır.
function GameSettingsPanel({ onError }) {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');

  useEffect(() => {
    fetchAdminSettings(getToken())
      .then((s) =>
        setSettings({
          nightSeconds: Math.round(s.nightDurationMs / 1000),
          daySeconds: Math.round(s.dayDurationMs / 1000),
          voteSeconds: Math.round(s.voteDurationMs / 1000),
          roomNames: { ...s.roomNames },
          roleSets: Object.fromEntries(Object.entries(s.roleSets).map(([size, keys]) => [size, [...keys]])),
          supportedRoomSizes: s.supportedRoomSizes,
        })
      )
      .catch((err) => onError(err.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading || !settings) return <p className="center small">Yükleniyor...</p>;

  function toggleRole(size, roleKey) {
    setSettings((prev) => {
      const current = prev.roleSets[size] || [];
      const next = current.includes(roleKey) ? current.filter((k) => k !== roleKey) : [...current, roleKey];
      return { ...prev, roleSets: { ...prev.roleSets, [size]: next } };
    });
  }

  async function handleSave() {
    setSuccess('');
    for (const size of settings.supportedRoomSizes) {
      if ((settings.roleSets[size] || []).length !== Number(size)) {
        onError(`${size} kişilik oda için tam olarak ${size} rol seçmelisin (şu an ${settings.roleSets[size]?.length || 0}).`);
        return;
      }
    }
    setSaving(true);
    try {
      await updateAdminSettings(getToken(), {
        nightDurationMs: settings.nightSeconds * 1000,
        dayDurationMs: settings.daySeconds * 1000,
        voteDurationMs: settings.voteSeconds * 1000,
        roomNames: settings.roomNames,
        roleSets: settings.roleSets,
      });
      setSuccess('Ayarlar kaydedildi — bundan sonra oluşturulacak odalarda geçerli olacak.');
    } catch (err) {
      onError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {success && (
        <div className="error-banner" style={{ background: 'rgba(58,122,77,0.2)', borderColor: 'var(--good)', color: '#bfe6cb' }}>
          {success}
        </div>
      )}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Faz Süreleri</h3>
        <div className="row" style={{ flexWrap: 'wrap', gap: 16 }}>
          <div className="field" style={{ flex: 1, minWidth: 120 }}>
            <label>Gece (saniye)</label>
            <input
              type="number"
              min={3}
              max={300}
              value={settings.nightSeconds}
              onChange={(e) => setSettings((p) => ({ ...p, nightSeconds: Number(e.target.value) }))}
            />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 120 }}>
            <label>Gündüz Tartışma (saniye)</label>
            <input
              type="number"
              min={3}
              max={300}
              value={settings.daySeconds}
              onChange={(e) => setSettings((p) => ({ ...p, daySeconds: Number(e.target.value) }))}
            />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 120 }}>
            <label>Oylama (saniye)</label>
            <input
              type="number"
              min={3}
              max={300}
              value={settings.voteSeconds}
              onChange={(e) => setSettings((p) => ({ ...p, voteSeconds: Number(e.target.value) }))}
            />
          </div>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Oda İsimleri</h3>
        {settings.supportedRoomSizes.map((size) => (
          <div className="field" key={size}>
            <label>{size} kişilik oda</label>
            <input
              value={settings.roomNames[size] || ''}
              onChange={(e) => setSettings((p) => ({ ...p, roomNames: { ...p.roomNames, [size]: e.target.value } }))}
              maxLength={40}
            />
          </div>
        ))}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Rol Dağılımları</h3>
        <p className="small">Her oda boyutu için TAM OLARAK o kadar rol seçmelisin (örn. 4 kişilik oda = tam 4 rol).</p>
        {settings.supportedRoomSizes.map((size) => {
          const selected = settings.roleSets[size] || [];
          return (
            <div key={size} style={{ marginBottom: 16 }}>
              <h4 style={{ margin: '0 0 6px', color: 'var(--accent)' }}>
                {size} kişilik ({selected.length}/{size} seçili)
              </h4>
              <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
                {ALL_ROLE_KEYS.map((key) => (
                  <label
                    key={key}
                    className="small"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '4px 10px',
                      borderRadius: 999,
                      border: '2px solid var(--accent-soft)',
                      background: selected.includes(key) ? 'var(--accent-soft)' : 'transparent',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(key)}
                      onChange={() => toggleRole(size, key)}
                      style={{ margin: 0 }}
                    />
                    {ROLE_LABELS[key]}
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <button onClick={handleSave} disabled={saving} style={{ width: '100%' }}>
        {saving ? 'Kaydediliyor...' : 'Ayarları Kaydet'}
      </button>
    </div>
  );
}
