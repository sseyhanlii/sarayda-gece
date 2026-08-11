'use client';

import { useEffect, useState } from 'react';
import { fetchLeaderboard, fetchRoleLeaderboard, fetchMyProfile, deleteUserAccount, fetchPublicSettings } from '../../lib/api';
import { ROLE_LABELS, ALL_ROLE_KEYS, resolveRoleLabels } from '../../lib/roles';
import { getToken, isLoggedIn } from '../../lib/auth';
import NavBar from '../../components/NavBar';

export default function LeaderboardPage() {
  const [rows, setRows] = useState([]);
  const [byRole, setByRole] = useState({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  // Owner (ya da "delete_users" izni verilmiş bir admin) sıralamadan direkt
  // hesap silebilsin diye — normal kullanıcılar bu düğmeyi hiç görmez.
  const [canDelete, setCanDelete] = useState(false);
  // Owner admin panelinden rol isimlerini değiştirebiliyor — rol bazlı sıralama
  // başlıkları da sabit ROLE_LABELS yerine güncel etiketleri göstermeli.
  const [roleLabels, setRoleLabels] = useState(ROLE_LABELS);

  function loadLeaderboard() {
    setLoading(true);
    Promise.all([fetchLeaderboard(), fetchRoleLeaderboard().catch(() => ({}))])
      .then(([general, roleData]) => {
        setRows(general);
        setByRole(roleData);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadLeaderboard();
    fetchPublicSettings()
      .then((s) => setRoleLabels(resolveRoleLabels(s.roleLabels)))
      .catch(() => {});
    if (isLoggedIn()) {
      fetchMyProfile(getToken())
        .then((profile) => {
          setCanDelete(Boolean(profile.is_owner || profile.admin_permissions?.delete_users));
        })
        .catch(() => {});
    }
  }, []);

  async function handleDelete(row) {
    if (!confirm(`${row.username} hesabını KALICI olarak silmek istediğine emin misin? Bu geri alınamaz.`)) return;
    try {
      await deleteUserAccount(getToken(), row.id);
      loadLeaderboard();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <NavBar />
      <div className="page">
        <h1>Liderlik Tablosu</h1>
        {error && <div className="error-banner">{error}</div>}
        {loading ? (
          <p className="center small">Yükleniyor...</p>
        ) : (
          <>
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Genel Sıralama</h3>
              {rows.length === 0 ? (
                <p className="small center">Henüz kimse maç tamamlamadı — ilk sırayı sen kap!</p>
              ) : (
                <ul className="player-list">
                  {rows.map((row, i) => (
                    <li key={row.id}>
                      <span>
                        <strong>#{i + 1}</strong> {row.username}{' '}
                        <span className="small">
                          ({row.total_wins}/{row.total_games} galibiyet, %{row.win_rate})
                        </span>
                      </span>
                      <span className="row" style={{ gap: 8 }}>
                        <span className="badge">{row.total_score} puan</span>
                        {canDelete && (
                          <button className="danger" onClick={() => handleDelete(row)} style={{ padding: '4px 10px', fontSize: '0.75rem' }}>
                            Sil
                          </button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="card">
              <h3 style={{ marginTop: 0 }}>Role Göre En Çok Kazananlar</h3>
              {ALL_ROLE_KEYS.every((key) => !byRole[key]?.length) ? (
                <p className="small center">Henüz rol bazlı bir galibiyet kaydı yok.</p>
              ) : (
                ALL_ROLE_KEYS.filter((key) => byRole[key]?.length).map((key) => (
                  <div key={key} style={{ marginBottom: 16 }}>
                    <h4 style={{ margin: '0 0 6px', color: 'var(--accent)' }}>{roleLabels[key]}</h4>
                    <ul className="player-list">
                      {byRole[key].map((row, i) => (
                        <li key={row.username + i}>
                          <span>
                            <strong>#{i + 1}</strong> {row.avatar_emoji || '👤'} {row.username}
                          </span>
                          <span className="badge">
                            {row.wins}/{row.games_played} galibiyet
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
