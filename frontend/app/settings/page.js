'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { changePassword } from '../../lib/api';
import { getToken, isLoggedIn } from '../../lib/auth';
import NavBar from '../../components/NavBar';

export default function SettingsPage() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isLoggedIn()) router.replace('/login');
  }, [router]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (newPassword !== confirmPassword) {
      setError('Yeni şifreler eşleşmiyor.');
      return;
    }
    setSaving(true);
    try {
      await changePassword(getToken(), currentPassword, newPassword);
      setSuccess('Şifren güncellendi.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <NavBar />
      <div className="page">
        <h1>Hesap Ayarları</h1>

        {error && <div className="error-banner">{error}</div>}
        {success && (
          <div className="error-banner" style={{ background: 'rgba(58,122,77,0.2)', borderColor: 'var(--good)', color: '#bfe6cb' }}>
            {success}
          </div>
        )}

        <div className="card">
          <h3>Şifre Değiştir</h3>
          <form onSubmit={handleSubmit}>
            <div className="field">
              <label>Mevcut şifre</label>
              <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
            </div>
            <div className="field">
              <label>Yeni şifre</label>
              <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={6} />
            </div>
            <div className="field">
              <label>Yeni şifre (tekrar)</label>
              <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={6} />
            </div>
            <button type="submit" disabled={saving} style={{ width: '100%' }}>
              {saving ? 'Güncelleniyor...' : 'Şifreyi Güncelle'}
            </button>
          </form>
        </div>

        <p className="small center">
          Kullanıcı adı ve avatarını değiştirmek için <a href="/profile">Profil</a> sayfasına bakabilirsin.
        </p>
      </div>
    </div>
  );
}
