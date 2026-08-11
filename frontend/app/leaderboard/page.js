'use client';

import { useEffect, useState } from 'react';
import { fetchLeaderboard, fetchRoleLeaderboard } from '../../lib/api';
import { ROLE_LABELS, ALL_ROLE_KEYS } from '../../lib/roles';
import NavBar from '../../components/NavBar';

export default function LeaderboardPage() {
  const [rows, setRows] = useState([]);
  const [byRole, setByRole] = useState({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([fetchLeaderboard(), fetchRoleLeaderboard().catch(() => ({}))])
      .then(([general, roleData]) => {
        setRows(general);
        setByRole(roleData);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

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
                      <span className="badge">{row.total_score} puan</span>
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
                    <h4 style={{ margin: '0 0 6px', color: 'var(--accent)' }}>{ROLE_LABELS[key]}</h4>
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
