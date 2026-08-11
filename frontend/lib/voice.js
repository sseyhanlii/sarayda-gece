'use client';

// ============================================================
// voice.js — Agora RTC ile sesli sohbet React hook'u.
//
// Mantık: her oda için İKİ Agora kanalı kullanılır:
//   1) `${roomCode}-day`            -> TÜM oyuncular burada, gündüz herkes birbirini duyar.
//   2) `${roomCode}-night-assassins` -> SADECE Gölge Lider + Zehirbaz burada, gizli kanal.
// Gece fazına girilince day kanalındaki mikrofon otomatik kapanır (herkes için);
// suikastçılar kendi gizli kanallarında "gizli kanalda konuş" düğmesiyle konuşabilir.
// Diğer oyuncular gece boyunca sessizdir (dinleyecek bir şey de yoktur).
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { getToken } from './auth';
import { fetchVoiceToken } from './api';

const ASSASSIN_ROLES = ['GOLGE_LIDER', 'ZEHIRBAZ'];

// Hatanın gerçekten mikrofon izniyle mi yoksa başka bir sebeple (token, ağ,
// sunucu yapılandırması) mi ilgili olduğunu ayırt eder — yanlış teşhise
// (örn. "mikrofon" derken aslında token hatası olması) düşmemek için.
function describeVoiceError(err) {
  const code = err?.code || '';
  const name = err?.name || '';
  const isPermissionIssue =
    code === 'PERMISSION_DENIED' ||
    code === 'NOT_READABLE' ||
    code === 'DEVICE_NOT_FOUND' ||
    name === 'NotAllowedError' ||
    name === 'NotFoundError';
  if (isPermissionIssue) {
    return 'Mikrofona erişilemedi. Tarayıcının mikrofon iznini kontrol et (adres çubuğundaki kilit simgesi).';
  }
  return `Sesli sohbet bağlantısı kurulamadı (${code || err?.message || 'bilinmeyen hata'}). Sayfayı yenilemeyi dene.`;
}

export function useVoiceChat({ appId, roomCode, userId, myRole, phase }) {
  const [micError, setMicError] = useState('');
  const [dayMicOn, setDayMicOn] = useState(false);
  const [nightMicOn, setNightMicOn] = useState(false);
  const [joined, setJoined] = useState(false);

  const dayClientRef = useRef(null);
  const nightClientRef = useRef(null);
  const localTrackRef = useRef(null);
  const nightJoinedRef = useRef(false);

  const isAssassin = ASSASSIN_ROLES.includes(myRole);

  // ---------- Gündüz kanalına bağlan (herkes, oda açıldığı anda) ----------
  useEffect(() => {
    if (!appId || !roomCode || !userId) return;
    let cancelled = false;

    async function connect() {
      try {
        const AgoraRTC = (await import('agora-rtc-sdk-ng')).default;
        const dayClient = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
        dayClientRef.current = dayClient;

        const localTrack = await AgoraRTC.createMicrophoneAudioTrack();
        if (cancelled) {
          localTrack.close();
          return;
        }
        localTrackRef.current = localTrack;
        localTrack.setMuted(true); // faz mantığı henüz devrede değil, varsayılan kapalı

        // Agora projesi "sertifikalı" (güvenli) modda olduğu için App ID'yi
        // token'sız kullanamıyoruz — backend'den bu kanala özel bir RTC token isteriz.
        const dayChannel = `${roomCode}-day`;
        const { token: dayToken } = await fetchVoiceToken(getToken(), dayChannel);

        await dayClient.join(appId, dayChannel, dayToken, userId);
        await dayClient.publish(localTrack);
        if (!cancelled) setJoined(true);
      } catch (err) {
        console.error('Ses bağlantısı kurulamadı:', err);
        if (!cancelled) {
          setMicError(describeVoiceError(err));
        }
      }
    }
    connect();

    return () => {
      cancelled = true;
      localTrackRef.current?.close();
      dayClientRef.current?.leave().catch(() => {});
      nightClientRef.current?.leave().catch(() => {});
      dayClientRef.current = null;
      nightClientRef.current = null;
      nightJoinedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId, roomCode, userId]);

  // ---------- Faza göre gündüz kanalını otomatik sustur/aç ----------
  useEffect(() => {
    const track = localTrackRef.current;
    if (!track) return;
    const shouldBeMuted = phase === 'NIGHT';
    track.setMuted(shouldBeMuted);
    setDayMicOn(!shouldBeMuted);
  }, [phase]);

  // ---------- Suikastçılar için gizli gece kanalına (bir kez) katıl ----------
  useEffect(() => {
    if (!isAssassin || !appId || !roomCode || !userId || nightJoinedRef.current) return;
    let cancelled = false;

    async function joinNightChannel() {
      try {
        const AgoraRTC = (await import('agora-rtc-sdk-ng')).default;
        const nightClient = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
        const nightChannel = `${roomCode}-night-assassins`;
        const { token: nightToken } = await fetchVoiceToken(getToken(), nightChannel);
        await nightClient.join(appId, nightChannel, nightToken, `${userId}-night`);
        if (!cancelled) {
          nightClientRef.current = nightClient;
          nightJoinedRef.current = true;
        }
      } catch (err) {
        console.error('Gizli kanal bağlantısı kurulamadı:', err);
      }
    }
    joinNightChannel();

    return () => {
      cancelled = true;
    };
  }, [isAssassin, appId, roomCode, userId]);

  // Suikastçıların gizli kanalda mikrofonu açıp kapatması ("gizli kanalda konuş" düğmesi)
  async function toggleNightMic() {
    const track = localTrackRef.current;
    const nightClient = nightClientRef.current;
    if (!track || !nightClient) return;
    try {
      if (nightMicOn) {
        await nightClient.unpublish();
        setNightMicOn(false);
      } else {
        await nightClient.publish(track);
        setNightMicOn(true);
      }
    } catch (err) {
      console.error('Gizli kanal mikrofon hatası:', err);
    }
  }

  return {
    joined,
    micError,
    dayMicOn,
    nightMicOn,
    isAssassin,
    toggleNightMic,
    canUseNightChannel: isAssassin && phase === 'NIGHT',
  };
}
