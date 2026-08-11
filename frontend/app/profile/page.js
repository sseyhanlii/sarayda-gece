'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchMyProfile, updateMyProfile, fetchAvailableAvatars } from '../../lib/api';
import { getToken, isLoggedIn, saveSession } from '../../lib/auth';
import { DEFAULT_AVATAR_EMOJIS } from '../../lib/roles';
import NavBar from '../../components/NavBar';

export default function ProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState(null);
  const [username, setUsername] = useState('');
  const [avatarEmoji, setAvatarEmoji] = useState('👤');
  const [avatars, setAvatars] = useState(DEFAULT_AVATAR_EMOJIS);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace('/login');
      return;
    }
    const token = getToken();
    Promise.all([fetchMyProfile(token), fetchAvailableAvatars().catch(() => null)])
      .then(([profileData, avatarData]) => {
        setProfile(profileData);
        setUsername(profileData.username);
        setAvatarEmoji(profileData.avatar_emoji || '👤');
        if (avatarData?.avatars) setAvatars(avatarData.avatars);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [router]);

  async function handleSave(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      const token = getToken();
      const updated = await updateMyProfile(token, { username, avatarEmoji });
      saveSession(token, {
        id: updated.id,
        username: updated.username,
        email: updated.email,
        avatarEmoji: updated.avatar_emoji,
        isAdmin: updated.is_admin,
      });
      setSuccess('Profil güncellendi.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div>
        <NavBar />
        <div className="page center">Yükleniyor...</div>
      </div>
    );
  }

  const stats = profile?.stats || {};

  return (
    <div>
      <NavBar />
      <div className="page">
        <h1>Profilim</h1>

        {error && <div className="error-banner">{error}</div>}
        {success && (
          <div className="error-banner" style={{ background: 'rgba(58,122,77,0.2)', borderColor: 'var(--good)', color: '#bfe6cb' }}>
            {success}
          </div>
        )}

        <div className="card">
          <h3>İstatistikler</h3>
          <div className="row" style={{ flexWrap: 'wrap', gap: 20 }}>
            <Stat label="Toplam Maç" value={stats.total_games || 0} />
            <Stat label="Galibiyet" value={stats.total_wins || 0} />
            <Stat label="Mağlubiyet" value={stats.total_losses || 0} />
            <Stat label="Puan" value={stats.total_score || 0} />
            <Stat label="Galibiyet Serisi" value={stats.current_win_streak || 0} />
          </div>
        </div>

        <div className="card">
          <h3>Profili Düzenle</h3>
          <form onSubmit={handleSave}>
            <div className="field">
              <label>Kullanıcı adı</label>
              <input value={username} onChange={(e) => setUsername(e.target.value)} maxLength={24} required />
            </div>
            <div className="field">
              <label>Avatar</label>
              <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
                {avatars.map((emoji) => (
                  <button
                    type="button"
                    key={emoji}
                    onClick={() => setAvatarEmoji(emoji)}
                    className={avatarEmoji === emoji ? '' : 'secondary'}
                    style={{ fontSize: '1.4rem', padding: '8px 14px' }}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>E-posta</label>
              <input value={profile?.email || ''} disabled />
            </div>
            <button type="submit" disabled={saving} style={{ width: '100%' }}>
              {saving ? 'Kaydediliyor...' : 'Kaydet'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div style={{ textAlign: 'center', minWidth: 80 }}>
      <div style={{ fontSize: '1.4rem', color: 'var(--accent)', fontWeight: 'bold' }}>{value}</div>
      <div className="small">{label}</div>
    </div>
  );
}
