'use client';

import { useRouter } from 'next/navigation';
import { getUser, clearSession } from '../lib/auth';
import { disconnectSocket } from '../lib/socket';

// Basit üst gezinme çubuğu — lobi, profil, liderlik tablosu, ayarlar ve
// (varsa) admin bağlantılarını gösterir. Oyun ekranında (room sayfası)
// bilinçli olarak kullanılmıyor, orada tek odak oyun olmalı.
export default function NavBar() {
  const router = useRouter();
  const user = getUser();

  function handleLogout() {
    disconnectSocket();
    clearSession();
    router.push('/login');
  }

  return (
    <nav className="navbar">
      <div className="navbar-inner">
        <a href="/lobby" className="navbar-brand">
          🏰 Sarayda Gece
        </a>
        <div className="navbar-links">
          <a href="/lobby">Lobi</a>
          <a href="/leaderboard">Liderlik Tablosu</a>
          <a href="/profile">Profil</a>
          <a href="/settings">Ayarlar</a>
          {user?.isAdmin && <a href="/admin">Yönetici</a>}
          <a href="#" onClick={handleLogout}>
            Çıkış
          </a>
        </div>
      </div>
    </nav>
  );
}
