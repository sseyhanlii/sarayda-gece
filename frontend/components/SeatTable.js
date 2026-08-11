'use client';

// ============================================================
// SeatTable — oyuncuları yuvarlak bir masa etrafında "sandalyelerde"
// gösteren görsel bileşen. players.length'e göre eşit açılarla dağıtır,
// bu yüzden 4/6/8 kişilik odaların hepsinde otomatik çalışır.
// ============================================================

export default function SeatTable({ players, hostUserId, myUserId, centerLabel, onKick }) {
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

        return (
          <div
            key={p.userId}
            className={`seat ${isHost ? 'host' : ''} ${isDead ? 'dead' : ''}`}
            style={{ left: `${left}%`, top: `${top}%` }}
          >
            <div className="seat-avatar">{p.avatarEmoji || '👤'}</div>
            <div className="seat-name">
              {p.username}
              {isMe ? ' (sen)' : ''}
            </div>
            {isHost && <div className="small">Kurucu</div>}
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
