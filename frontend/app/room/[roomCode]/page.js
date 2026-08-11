'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getSocket } from '../../../lib/socket';
import { getUser, isLoggedIn } from '../../../lib/auth';
import { ROLE_LABELS, ROLE_DESCRIPTIONS, TEAM_LABELS, ALL_ROLE_KEYS } from '../../../lib/roles';
import SeatTable from '../../../components/SeatTable';
import { useVoiceChat } from '../../../lib/voice';

const AGORA_APP_ID = process.env.NEXT_PUBLIC_AGORA_APP_ID || '';

// Backend'deki sabitlerle birebir eşleşir (bkz. backend/game/gameRoom.js)
const PHASE_DURATIONS = {
  NIGHT: 45,
  DAY_DISCUSSION: 90,
  DAY_VOTE: 30,
  PENDING_EXECUTION: 15,
};

const PHASE_LABELS = {
  LOBBY: 'Lobi',
  NIGHT: 'Gece',
  DAY_DISCUSSION: 'Gündüz — Tartışma',
  DAY_VOTE: 'Gündüz — Oylama',
  PENDING_EXECUTION: 'İdam Bekleniyor',
  RESULTS: 'Sonuçlar',
};

export default function RoomPage() {
  const params = useParams();
  const router = useRouter();
  const roomCode = params.roomCode;
  const user = getUser();

  const [players, setPlayers] = useState([]);
  const [roomSize, setRoomSize] = useState(8);
  const [hostUserId, setHostUserId] = useState(null);
  const [phase, setPhase] = useState('LOBBY');
  const [dayNumber, setDayNumber] = useState(0);
  const [myRole, setMyRole] = useState(null);
  const [myTeam, setMyTeam] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [infoMessage, setInfoMessage] = useState('');
  const [abilityResult, setAbilityResult] = useState(null);
  const [nightDeaths, setNightDeaths] = useState(null);
  const [voteTally, setVoteTally] = useState({});
  const [pendingExecutionTarget, setPendingExecutionTarget] = useState(null);
  const [princessRevealedUserId, setPrincessRevealedUserId] = useState(null);
  const [lastExecution, setLastExecution] = useState(null);
  const [gameEndedData, setGameEndedData] = useState(null);
  const [actionSubmitted, setActionSubmitted] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(null);

  const socketRef = useRef(null);

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace('/login');
      return;
    }
    const socket = getSocket();
    socketRef.current = socket;

    socket.emit('joinRoom', { roomCode }); // odaya zaten katılmışsa sunucu bunu görmezden gelir/hata döner, sorun değil

    const onRoomUpdate = (state) => {
      setPlayers(state.players);
      setHostUserId(state.hostUserId);
      setPhase(state.phase);
      if (state.roomSize) setRoomSize(state.roomSize);
    };
    const onGameStarted = ({ yourRole, team }) => {
      setMyRole(yourRole);
      setMyTeam(team);
      setGameEndedData(null);
      setNightDeaths(null);
      setLastExecution(null);
      setPrincessRevealedUserId(null);
    };
    const onPhaseChanged = ({ phase: newPhase, dayNumber: newDay }) => {
      setPhase(newPhase);
      setDayNumber(newDay);
      setActionSubmitted(false);
      setAbilityResult(null);
      setPendingExecutionTarget(null);
      setVoteTally({});
    };
    const onAbilityResult = (payload) => setAbilityResult(payload);
    const onNightResult = ({ deaths }) => setNightDeaths(deaths);
    const onVoteUpdate = ({ votes }) => setVoteTally(votes);
    const onPendingExecution = ({ targetUserId }) => setPendingExecutionTarget(targetUserId);
    const onPrincessRevealed = ({ userId }) => setPrincessRevealedUserId(userId);
    const onExecutionResult = (payload) => setLastExecution(payload);
    const onGameEnded = (payload) => setGameEndedData(payload);
    const onError = (payload) => setErrorMessage(payload.message);
    const onKicked = () => {
      alert('Oda kurucusu seni odadan çıkardı.');
      router.push('/lobby');
    };
    const onRoomClosedByAdmin = () => {
      alert('Bu oda bir yönetici tarafından kapatıldı.');
      router.push('/lobby');
    };
    const onAdminEndedGame = () => setInfoMessage('Bu maç bir yönetici tarafından sonlandırıldı, oda lobiye döndü.');

    socket.on('roomUpdate', onRoomUpdate);
    socket.on('gameStarted', onGameStarted);
    socket.on('phaseChanged', onPhaseChanged);
    socket.on('abilityResult', onAbilityResult);
    socket.on('nightResult', onNightResult);
    socket.on('voteUpdate', onVoteUpdate);
    socket.on('pendingExecution', onPendingExecution);
    socket.on('princessRevealed', onPrincessRevealed);
    socket.on('executionResult', onExecutionResult);
    socket.on('gameEnded', onGameEnded);
    socket.on('error', onError);
    socket.on('kickedFromRoom', onKicked);
    socket.on('roomClosedByAdmin', onRoomClosedByAdmin);
    socket.on('adminEndedGame', onAdminEndedGame);

    return () => {
      socket.off('roomUpdate', onRoomUpdate);
      socket.off('gameStarted', onGameStarted);
      socket.off('phaseChanged', onPhaseChanged);
      socket.off('abilityResult', onAbilityResult);
      socket.off('nightResult', onNightResult);
      socket.off('voteUpdate', onVoteUpdate);
      socket.off('pendingExecution', onPendingExecution);
      socket.off('princessRevealed', onPrincessRevealed);
      socket.off('executionResult', onExecutionResult);
      socket.off('gameEnded', onGameEnded);
      socket.off('error', onError);
      socket.off('kickedFromRoom', onKicked);
      socket.off('roomClosedByAdmin', onRoomClosedByAdmin);
      socket.off('adminEndedGame', onAdminEndedGame);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode]);

  // Faz değişince yaklaşık bir geri sayım başlat (sunucuyla tam senkron değil,
  // sadece oyunculara "ne kadar zaman kaldı" hissi vermek için).
  useEffect(() => {
    const duration = PHASE_DURATIONS[phase];
    if (!duration) {
      setSecondsLeft(null);
      return;
    }
    setSecondsLeft(duration);
    const interval = setInterval(() => {
      setSecondsLeft((s) => (s && s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [phase, dayNumber]);

  const isHost = user?.id === hostUserId;
  const me = players.find((p) => p.userId === user?.id);
  const alivePlayers = players.filter((p) => p.isAlive);
  const othersAlive = alivePlayers.filter((p) => p.userId !== user?.id);

  // Sesli sohbet: Lobi dışında (rol atanmışsa) bağlan. myRole başta null olduğu için
  // suikastçı özel kanalı rol atandıktan sonra devreye girer, gündüz/gece herkes için
  // ana kanal oyuncu odaya girdiği anda bağlanır.
  const voice = useVoiceChat({
    appId: AGORA_APP_ID,
    roomCode,
    userId: user?.id,
    myRole,
    phase,
  });

  function handleStartGame() {
    socketRef.current.emit('startGame');
  }

  function handleKick(targetUserId) {
    if (!confirm('Bu oyuncuyu odadan atmak istediğine emin misin?')) return;
    socketRef.current.emit('kickPlayer', { targetUserId });
  }

  function handleAbort() {
    if (!confirm('Maçı erken bitirip odayı lobiye döndürmek istediğine emin misin?')) return;
    socketRef.current.emit('abortGame');
  }

  function submitAbility(abilityKey, targetUserId, mode) {
    socketRef.current.emit('useAbility', { abilityKey, targetUserId, mode });
    setActionSubmitted(true);
  }

  function submitVote(targetUserId) {
    socketRef.current.emit('castVote', { targetUserId });
  }

  function claimPrincess() {
    socketRef.current.emit('claimPrincess');
  }

  if (gameEndedData) {
    return (
      <div className="page">
        <h1>Oyun Bitti</h1>
        <div className="card center">
          <h2>{TEAM_LABELS[gameEndedData.winningTeam] || gameEndedData.winningTeam} kazandı!</h2>
          <ul className="player-list">
            {gameEndedData.roleReveal.map((p) => {
              const player = players.find((pl) => pl.userId === p.userId);
              return (
                <li key={p.userId} className={!p.isAlive ? 'dead' : ''}>
                  <span>{player?.username || p.userId}</span>
                  <span className="badge">{ROLE_LABELS[p.role]}</span>
                </li>
              );
            })}
          </ul>
          <button onClick={() => router.push('/lobby')} style={{ marginTop: 16 }}>
            Lobiye Dön
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <h1>Sarayda Gece</h1>
      <p className="subtitle">
        Oda: <strong>{roomCode}</strong> ({roomSize} kişilik) — {PHASE_LABELS[phase]}
        {dayNumber > 0 ? ` (${phase === 'NIGHT' ? 'Gece' : 'Gün'} ${dayNumber})` : ''}
        {secondsLeft !== null ? ` — ~${secondsLeft} sn` : ''}
      </p>

      {errorMessage && <div className="error-banner">{errorMessage}</div>}
      {infoMessage && <div className="error-banner" style={{ background: 'rgba(58,122,77,0.2)', borderColor: 'var(--good)', color: '#bfe6cb' }}>{infoMessage}</div>}

      <VoiceStatusBar voice={voice} phase={phase} />

      <SeatTable
        players={players}
        hostUserId={hostUserId}
        myUserId={user?.id}
        centerLabel={`${roomCode}\n${PHASE_LABELS[phase]}`}
        onKick={isHost && phase === 'LOBBY' ? handleKick : null}
      />

      {isHost && phase !== 'LOBBY' && !gameEndedData && (
        <div className="center" style={{ marginBottom: 16 }}>
          <button className="danger" onClick={handleAbort}>
            Maçı Bitir / Odayı Sıfırla
          </button>
        </div>
      )}

      {phase === 'LOBBY' && (
        <div className="card center">
          <p>
            {players.length}/{roomSize} oyuncu hazır
          </p>
          {isHost && (
            <button onClick={handleStartGame} disabled={players.length !== roomSize} style={{ width: '100%', marginTop: 8 }}>
              {players.length === roomSize ? 'Oyunu Başlat' : `${roomSize - players.length} kişi daha bekleniyor`}
            </button>
          )}
        </div>
      )}

      {myRole && phase !== 'LOBBY' && (
        <div className="card role-card">
          <h2>{ROLE_LABELS[myRole]}</h2>
          <p className="small">{ROLE_DESCRIPTIONS[myRole]}</p>
          <span className="badge">{TEAM_LABELS[myTeam]}</span>
        </div>
      )}

      {phase === 'NIGHT' && (
        <NightActionPanel
          myRole={myRole}
          othersAlive={othersAlive}
          isAlive={me?.isAlive}
          actionSubmitted={actionSubmitted}
          abilityResult={abilityResult}
          onSubmit={submitAbility}
        />
      )}

      {nightDeaths && phase !== 'NIGHT' && (
        <div className="card">
          <h3>Sabah Haberleri</h3>
          {nightDeaths.length === 0 ? (
            <p>Bu gece kimse ölmedi.</p>
          ) : (
            <ul className="player-list">
              {nightDeaths.map((d) => {
                const player = players.find((p) => p.userId === d.userId);
                return (
                  <li key={d.userId} className="dead">
                    <span>{player?.username || d.userId}</span>
                    <span className="badge">{d.cause}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {phase === 'DAY_DISCUSSION' && (
        <div className="card">
          <h3>Tartışma Zamanı</h3>
          <p className="small">Kimin şüpheli olduğunu tartışın — sesli sohbet gündüz fazında herkese açık.</p>
        </div>
      )}

      {phase === 'DAY_VOTE' && me?.isAlive && (
        <div className="card">
          <h3>İdam Oylaması</h3>
          <ul className="player-list">
            {othersAlive.map((p) => (
              <li key={p.userId}>
                <span>
                  {p.username} <span className="small">({voteTally[p.userId] || 0} oy)</span>
                </span>
                <button onClick={() => submitVote(p.userId)}>Oy Ver</button>
              </li>
            ))}
          </ul>
          <button className="secondary" onClick={() => submitVote(null)} style={{ marginTop: 10, width: '100%' }}>
            Çekimser Kal
          </button>
        </div>
      )}

      {phase === 'PENDING_EXECUTION' && pendingExecutionTarget && (
        <div className="card center">
          <h3>İdam Kesinleşiyor...</h3>
          <p>
            {players.find((p) => p.userId === pendingExecutionTarget)?.username || pendingExecutionTarget} idam
            edilmek üzere.
          </p>
          {myRole === 'GIZLI_PRENSES' && pendingExecutionTarget === user?.id && (
            <button className="danger" onClick={claimPrincess}>
              BEN PRENSESİM! Kartımı Açıyorum
            </button>
          )}
        </div>
      )}

      {princessRevealedUserId && (
        <div className="card center">
          <p>
            <strong>{players.find((p) => p.userId === princessRevealedUserId)?.username}</strong> kartını açtı — idam
            iptal edildi!
          </p>
        </div>
      )}

      {lastExecution && phase !== 'PENDING_EXECUTION' && (
        <div className="card center">
          <p>
            <strong>{players.find((p) => p.userId === lastExecution.userId)?.username}</strong> idam edildi. Rolü:{' '}
            <span className="badge">{ROLE_LABELS[lastExecution.roleReveal] || '?'}</span>
          </p>
        </div>
      )}
    </div>
  );
}

function NightActionPanel({ myRole, othersAlive, isAlive, actionSubmitted, abilityResult, onSubmit }) {
  const [target, setTarget] = useState('');
  const [doctorMode, setDoctorMode] = useState('antidote');
  const [lockRole, setLockRole] = useState('');

  if (!isAlive) {
    return (
      <div className="card center">
        <p className="small">Elendin — bu gece sadece izleyicisin.</p>
      </div>
    );
  }

  if (actionSubmitted) {
    return (
      <div className="card center">
        <p>Gece aksiyonun gönderildi. Sabahı bekle...</p>
        {abilityResult && (
          <p className="small">
            Sonuç: <span className="badge">{abilityResult.result}</span>
          </p>
        )}
      </div>
    );
  }

  if (myRole === 'MUHAFIZ') {
    return (
      <div className="card">
        <h3>Kimi koruyacaksın?</h3>
        <TargetSelect players={othersAlive} value={target} onChange={setTarget} />
        <button disabled={!target} onClick={() => onSubmit('GUARD_PROTECT', target)} style={{ marginTop: 10, width: '100%' }}>
          Koru
        </button>
      </div>
    );
  }

  if (myRole === 'BAS_CASUS') {
    return (
      <div className="card">
        <h3>Kimi araştıracaksın?</h3>
        <TargetSelect players={othersAlive} value={target} onChange={setTarget} />
        <button disabled={!target} onClick={() => onSubmit('SPY_INVESTIGATE', target)} style={{ marginTop: 10, width: '100%' }}>
          Araştır
        </button>
      </div>
    );
  }

  if (myRole === 'GOLGE_LIDER') {
    return (
      <div className="card">
        <h3>Suikast hedefi</h3>
        <TargetSelect players={othersAlive} value={target} onChange={setTarget} />
        <button disabled={!target} onClick={() => onSubmit('ASSASSIN_CHOOSE_TARGET', target)} style={{ marginTop: 10, width: '100%' }}>
          Hedefi Belirle
        </button>
        <p className="small" style={{ marginTop: 10 }}>
          Oyun boyu 1 kez, hedefinin Prenses olup olmadığını da sorgulayabilirsin (bu hakkı ayrı kullan).
        </p>
        <button
          className="secondary"
          disabled={!target}
          onClick={() => onSubmit('QUERY_IS_PRINCESS', target)}
          style={{ width: '100%' }}
        >
          Prenses mi diye sorgula
        </button>
      </div>
    );
  }

  if (myRole === 'HEKIM') {
    return (
      <div className="card">
        <h3>Hekim müdahalesi</h3>
        <div className="field">
          <label>Müdahale türü</label>
          <select value={doctorMode} onChange={(e) => setDoctorMode(e.target.value)}>
            <option value="antidote">Panzehir (koru)</option>
            <option value="poison">Zehir (öldür)</option>
          </select>
        </div>
        <TargetSelect players={othersAlive} value={target} onChange={setTarget} />
        <button
          disabled={!target}
          onClick={() => onSubmit('DOCTOR_ANTIDOTE_OR_POISON', target, doctorMode)}
          style={{ marginTop: 10, width: '100%' }}
        >
          Uygula
        </button>
      </div>
    );
  }

  if (myRole === 'ZEHIRBAZ') {
    return (
      <div className="card">
        <h3>Hangi rolü kilitleyeceksin?</h3>
        <div className="field">
          <select value={lockRole} onChange={(e) => setLockRole(e.target.value)}>
            <option value="">Seç...</option>
            {ALL_ROLE_KEYS.map((key) => (
              <option key={key} value={key}>
                {ROLE_LABELS[key]}
              </option>
            ))}
          </select>
        </div>
        <button disabled={!lockRole} onClick={() => onSubmit('POISONER_LOCK_ABILITY', lockRole)} style={{ width: '100%' }}>
          Kilitle (oyun boyu 1 kez)
        </button>
      </div>
    );
  }

  return (
    <div className="card center">
      <p className="small">Bu gece pasifsin — sabahı bekle.</p>
    </div>
  );
}

function TargetSelect({ players, value, onChange }) {
  return (
    <div className="field">
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Bir oyuncu seç...</option>
        {players.map((p) => (
          <option key={p.userId} value={p.userId}>
            {p.username}
          </option>
        ))}
      </select>
    </div>
  );
}

function VoiceStatusBar({ voice, phase }) {
  if (!process.env.NEXT_PUBLIC_AGORA_APP_ID) {
    return (
      <p className="small center" style={{ marginBottom: 12 }}>
        🔇 Sesli sohbet yapılandırılmamış (NEXT_PUBLIC_AGORA_APP_ID eksik).
      </p>
    );
  }

  if (voice.micError) {
    return <div className="error-banner">{voice.micError}</div>;
  }

  return (
    <div className="card" style={{ padding: '10px 16px', marginBottom: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="small">
          {!voice.joined
            ? '🔌 Sesli sohbete bağlanıyor...'
            : voice.dayMicOn
            ? '🔊 Genel kanal açık — mikrofon aktif'
            : '🌙 Genel kanal sessiz (mikrofon kapalı)'}
        </span>
        {voice.canUseNightChannel && (
          <button className={voice.nightMicOn ? 'danger' : 'secondary'} onClick={voice.toggleNightMic}>
            {voice.nightMicOn ? '🎙️ Gizli Kanalda Konuşuyorsun (Kapat)' : '🤫 Gizli Kanalda Konuş'}
          </button>
        )}
      </div>
    </div>
  );
}
