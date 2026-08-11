'use client';

// ============================================================
// SeatTable — oyuncuları yuvarlak bir masa etrafında "sandalyelerde"
// gösteren görsel bileşen. players.length'e göre eşit açılarla dağıtır,
// bu yüzden 4/6/8 kişilik odaların hepsinde otomatik çalışır.
// Her oyuncunun sabit bir rengi vardır, konuşurken parlar, öldüğünde
// kafatası ile işaretlenir, lobide "hazır" durumu bir tikle gösterilir.
// ============================================================

import { getPlayerColor } from '../lib/roles';

export default function SeatTable({ players, hostUserId, myUserId, centerLabel, onKick, speakingUserIds, showReady }) {
  const radiusPercent = 42;
  const count = players.length || 1;

  return (
    <div className="table-wrap">
      <div className="table-center">{centerLabel}</div>
      {players.map((p, i) => {
        const angle = (i / count) * 2 * Math.PI - Math.PI / 2; // üstten başla, saat yönü
        const left = 50 + radiusPercent * Math.cos(angle);
        const top = 50 + radiusPercent * Math.sin(angle);
        const isHost = p.userId === hostUserId;
        const isMe = p.userId === myUserId;
        const isDead = p.isAlive === false;
        const isSpeaking = !isDead && speakingUserIds?.has(String(p.userId));
        const color = getPlayerColor(p.userId);

        return (
          <div
            key={p.userId}
            className={`seat ${isHost ? 'host' : ''} ${isDead ? 'dead' : ''} ${isSpeaking ? 'speaking' : ''}`}
            style={{ left: `${left}%`, top: `${top}%` }}
          >
            <div className="seat-avatar" style={{ borderColor: color, '--speak-color': color }}>
              {p.avatarUrl ? (
                <img src={p.avatarUrl} alt={p.username} className="seat-avatar-img" />
              ) : (
                p.avatarEmoji || '👤'
              )}
              {isDead && <span className="seat-dead-mark">💀</span>}
              {p.isBot && !isDead && <span className="seat-bot-mark">🤖</span>}
            </div>
            <div className="seat-name" style={{ color }}>
              {p.username}
              {isMe ? ' (sen)' : ''}
            </div>
            {isHost && <div className="small">Kurucu</div>}
            {showReady && !isDead && (
              <div className={`seat-ready-pill ${p.isReady ? 'ready' : ''}`}>{p.isReady ? '✔ Hazır' : 'Bekliyor'}</div>
            )}
            {onKick && !isHost && !isMe && (
              <button className="seat-kick" onClick={() => onKick(p.userId)}>
                At
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
