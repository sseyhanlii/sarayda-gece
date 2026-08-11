// ============================================================
// voice-chat-example.js — FRONTEND örneği (Next.js/React içinde kullanılır)
// Sesli sohbet entegrasyonu: Agora RTC SDK ile gece/gündüz kanal mantığı.
//
// NEDEN AGORA/DAILY.CO, HAM WebRTC MESH DEĞİL?
// 8 kişilik tam-mesh WebRTC'de her istemci diğer 7'siyle ayrı P2P bağlantı
// kurar (8 kişi = 28 bağlantı). Bu; ICE/TURN sunucusu yönetimini, bant
// genişliği/CPU yükünü ve "gece fazında suikastçıları ayrı bir kanala al"
// gibi dinamik grup geçişlerini elle yönetmeyi gerektirir. Agora/Daily.co gibi
// SFU tabanlı SDK'lar bunu tek bir "kanal değiştir" çağrısına indirger ve
// ücretsiz katmanları (Agora: aylık 10.000 dakika, Daily.co: sınırlı ücretsiz
// dakika) bu ölçekteki bir arkadaş-grubu oyunu için yeterlidir.
// ============================================================

import AgoraRTC from 'agora-rtc-sdk-ng';
import { useEffect, useRef, useState } from 'react';

// Her oyun odası için İKİ ayrı Agora kanalı kullanıyoruz:
//   1) `${roomCode}-day`   -> Gündüz: TÜM oyuncular (canlı) bu kanalda, herkes duyar.
//   2) `${roomCode}-night-assassins` -> Gece: SADECE Gölge Lider + Zehirbaz burada,
//      birbirleriyle fısıldaşabilir ("bas-konuş" mantığı istemci tarafında toggle edilir).
// Diğer oyuncular gece fazında `day` kanalında mikrofonu kapatılmış (muted) halde kalır.

export function useVoiceChat({ appId, roomCode, userId, myRole, phase }) {
  const dayClientRef = useRef(null);
  const nightClientRef = useRef(null);
  const localAudioTrackRef = useRef(null);
  const [isMuted, setIsMuted] = useState(true);

  const ASSASSIN_ROLES = ['GOLGE_LIDER', 'ZEHIRBAZ'];
  const isAssassin = ASSASSIN_ROLES.includes(myRole);

  // Kanallara bağlan (component mount olduğunda bir kez)
  useEffect(() => {
    let mounted = true;
    async function connect() {
      const dayClient = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
      const localTrack = await AgoraRTC.createMicrophoneAudioTrack();
      localAudioTrackRef.current = localTrack;

      await dayClient.join(appId, `${roomCode}-day`, null, userId);
      await dayClient.publish(localTrack);
      dayClientRef.current = dayClient;

      // Suikastçılar için ikinci (gizli) kanal — sadece onlar publish/subscribe eder
      if (isAssassin) {
        const nightClient = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
        await nightClient.join(appId, `${roomCode}-night-assassins`, null, `${userId}-night`);
        nightClientRef.current = nightClient;
      }
      if (mounted) setIsMuted(true);
      localTrack.setMuted(true); // varsayılan: kapalı, faz mantığı açacak
    }
    connect();
    return () => {
      mounted = false;
      dayClientRef.current?.leave();
      nightClientRef.current?.leave();
      localAudioTrackRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode]);

  // FAZ DEĞİŞİNCE otomatik mute/unmute — server'dan gelen 'phaseChanged' event'i
  // bu hook'u tetikleyen `phase` prop'unu güncelleyince devreye girer.
  useEffect(() => {
    const track = localAudioTrackRef.current;
    if (!track) return;

    if (phase === 'DAY_DISCUSSION' || phase === 'DAY_VOTE') {
      // Gündüz: herkesin sesi day kanalında açık
      track.setMuted(false);
      setIsMuted(false);
      // Suikastçılar day kanalında da konuşabilir (kendi gizli kanalları ayrıca açık kalır)
    } else if (phase === 'NIGHT') {
      // Gece: day kanalında herkes susturulur.
      track.setMuted(true);
      setIsMuted(true);
      // Suikastçılar kendi gizli night kanalında bas-konuş yapabilir (aşağıdaki fonksiyon).
    }
  }, [phase]);

  // Suikastçılar için "bas konuş" (push-to-talk) — sadece gece fazında ve sadece
  // Gölge Lider / Zehirbaz rolündeki oyuncular bu fonksiyonu kullanabilir.
  async function pushToTalkNightChannel(active) {
    if (!isAssassin || !nightClientRef.current) return;
    if (active) {
      const track = localAudioTrackRef.current;
      await nightClientRef.current.publish(track);
    } else {
      await nightClientRef.current.unpublish();
    }
  }

  return { isMuted, pushToTalkNightChannel };
}

// ============================================================
// ALTERNATİF: Ham WebRTC mesh iskeleti (SDK kullanmadan, öğretim amaçlı)
// Küçük ölçekte (örn. 4-5 kişilik test) çalışır ama 8 kişide TURN sunucusu
// olmadan (örn. simetrik NAT arkasındaki oyuncularda) bağlantı sorunları
// çıkması muhtemeldir. Production için Agora/Daily.co önerilir.
// ============================================================
/*
const peers = new Map(); // remoteUserId -> RTCPeerConnection

function createPeerConnection(remoteUserId, socket, localStream) {
  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      // TURN sunucusu (NAT arkası bağlantılar için ZORUNLU, ücretsiz: metered.ca / Twilio TURN)
      { urls: 'turn:your-turn-server', username: '...', credential: '...' },
    ],
  });
  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

  pc.onicecandidate = (e) => {
    if (e.candidate) socket.emit('webrtc-ice', { to: remoteUserId, candidate: e.candidate });
  };
  pc.ontrack = (e) => {
    // e.streams[0] -> <audio> elementine bağlanır
  };

  peers.set(remoteUserId, pc);
  return pc;
}
// Sinyalleşme (offer/answer/ice) Socket.io üzerinden 'webrtc-offer', 'webrtc-answer',
// 'webrtc-ice' event'leriyle taşınır; server sadece mesajı ilgili odaya yönlendirir.
*/
