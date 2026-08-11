'use client';

import { useEffect, useState } from 'react';
import { fetchLeaderboard } from '../../lib/api';
import NavBar from '../../components/NavBar';

export default function LeaderboardPage() {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLeaderboard()
      .then(setRows)
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
          <div className="card">
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
        )}
      </div>
    </div>
  );
}
