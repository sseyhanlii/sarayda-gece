'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchMyProfile, updateMyProfile, fetchAvailableAvatars, uploadAvatarPhoto } from '../../lib/api';
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
  const [photoPreview, setPhotoPreview] = useState(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

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

  // Seçilen fotoğrafı tarayıcıda küçültüp (max 200x200, JPEG) veritabanına
  // gönderilecek küçük bir data URI'ye çeviriyoruz — ayrı bir dosya depolama
  // servisi (Supabase Storage vb.) kurmadan basitçe çalışsın diye.
  function handlePhotoSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => {
      img.onload = () => {
        const size = 200;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        const scale = Math.max(size / img.width, size / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        setPhotoPreview(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  async function handleUploadPhoto() {
    if (!photoPreview) return;
    setError('');
    setSuccess('');
    setUploadingPhoto(true);
    try {
      const token = getToken();
      await uploadAvatarPhoto(token, photoPreview);
      const fresh = await fetchMyProfile(token);
      setProfile(fresh);
      setPhotoPreview(null);
      setSuccess('Fotoğrafın yüklendi — bir yönetici onaylayınca profilinde görünecek.');
    } catch (err) {
      setError(err.message);
    } finally {
      setUploadingPhoto(false);
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

        {profile?.profile_locked && (
          <div className="error-banner">
            🔒 Bir yönetici ad/fotoğraf değiştirmeni kilitledi — profilini düzenleyemezsin.
          </div>
        )}

        <div className="card">
          <h3>Fotoğraf</h3>
          {photoPreview || profile?.avatar_url ? (
            <img src={photoPreview || profile.avatar_url} alt="avatar" className="avatar-preview" />
          ) : (
            <div className="center" style={{ fontSize: '3rem', marginBottom: 12 }}>{avatarEmoji}</div>
          )}
          {profile?.avatar_status && profile.avatar_status !== 'NONE' && (
            <p className="center">
              <span className={`avatar-status-pill ${profile.avatar_status}`}>
                {profile.avatar_status === 'PENDING' && 'Onay bekliyor'}
                {profile.avatar_status === 'APPROVED' && 'Onaylandı'}
                {profile.avatar_status === 'REJECTED' && 'Reddedildi — tekrar deneyebilirsin'}
              </span>
            </p>
          )}
          {!profile?.profile_locked && (
            <>
              <input type="file" accept="image/*" onChange={handlePhotoSelect} className="small" />
              {photoPreview && (
                <button onClick={handleUploadPhoto} disabled={uploadingPhoto} style={{ width: '100%', marginTop: 10 }}>
                  {uploadingPhoto ? 'Yükleniyor...' : 'Bu Fotoğrafı Gönder (Onaya Sun)'}
                </button>
              )}
              <p className="small" style={{ marginTop: 8 }}>
                Yüklediğin fotoğraf bir yönetici onaylayana kadar herkese görünmez — o ana kadar emoji avatarın kullanılır.
              </p>
            </>
          )}
        </div>

        <div className="card">
          <h3>Profili Düzenle</h3>
          <form onSubmit={handleSave}>
            <div className="field">
              <label>Kullanıcı adı</label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                maxLength={24}
                required
                disabled={profile?.profile_locked}
              />
            </div>
            <div className="field">
              <label>Avatar (emoji)</label>
              <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
                {avatars.map((emoji) => (
                  <button
                    type="button"
                    key={emoji}
                    disabled={profile?.profile_locked}
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
            <button type="submit" disabled={saving || profile?.profile_locked} style={{ width: '100%' }}>
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
