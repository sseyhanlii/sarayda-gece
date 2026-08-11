'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getUser, clearSession } from '../lib/auth';
import { disconnectSocket, getSocket } from '../lib/socket';

// Basit üst gezinme çubuğu — lobi, profil, liderlik tablosu, ayarlar ve
// (varsa) admin bağlantılarını gösterir. Oyun ekranında (room sayfası)
// bilinçli olarak kullanılmıyor, orada tek odak oyun olmalı.
export default function NavBar() {
  const router = useRouter();
  const user = getUser();
  // Toplam çevrimiçi (giriş yapmış) kullanıcı sayısı — sunucu her bağlantı/
  // ayrılma olduğunda anlık yayınlıyor (bkz. onlineCountUpdate), sayfa
  // yenilemeye gerek yok. NavBar her sayfada göründüğü için burada tutuluyor.
  const [onlineCount, setOnlineCount] = useState(null);

  useEffect(() => {
    const socket = getSocket();
    function handleOnlineCount({ count }) {
      setOnlineCount(count);
    }
    socket.on('onlineCountUpdate', handleOnlineCount);
    return () => {
      socket.off('onlineCountUpdate', handleOnlineCount);
    };
  }, []);

  function handleLogout() {
    disconnectSocket();
    clearSession();
    router.push('/login');
  }

  return (
    <nav className="navbar">
      <div className="navbar-inner">
        <a href="/lobby" className="navbar-brand">
          <span className="navbar-logo-icon" aria-hidden="true">
            <svg width="26" height="26" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M6 38V18l6 5 6-9 6 9 6-9 6 9 6-5v20a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2Z" fill="currentColor" opacity="0.9" />
              <circle cx="12" cy="14" r="2.4" fill="currentColor" />
              <circle cx="24" cy="10" r="2.6" fill="currentColor" />
              <circle cx="36" cy="14" r="2.4" fill="currentColor" />
            </svg>
          </span>
          Sarayda Gece
        </a>
        {onlineCount !== null && (
          <span className="online-badge" title="Şu anda çevrimiçi olan kullanıcı sayısı">
            <span className="online-dot" aria-hidden="true" /> {onlineCount} çevrimiçi
          </span>
        )}
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
