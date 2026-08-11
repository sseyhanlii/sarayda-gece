'use client';

// ============================================================
// voice.js — Agora RTC ile sesli sohbet React hook'u.
//
// Mantık: her oda için İKİ Agora kanalı kullanılır:
//   1) `${roomCode}-day`            -> TÜM oyuncular burada, GECE DAHİL herkes
//      birbirini duyabilir (kullanıcının açık isteğiyle: "gece herkes sesli
//      konuşabilsin"). Faz artık genel kanalı otomatik susturmuyor.
//   2) `${roomCode}-night-assassins` -> SADECE Gölge Lider + Zehirbaz burada,
//      gece fazında kullanılan ek/gizli bir kanal (yazılı sohbetle aynı mantık).
// Bir oyuncu ELENDİĞİNDE (isAlive=false) genel kanaldaki mikrofonu ZORUNLU
// olarak kapanır — artık konuşamaz (ve yayın yapmadığı için kimse onu duymaz),
// sadece izleyici kalır.
// ============================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { getToken } from './auth';
import { fetchVoiceToken } from './api';

const ASSASSIN_ROLES = ['GOLGE_LIDER', 'ZEHIRBAZ'];
const NIGHT_UID_SUFFIX = '-night';
// Önceki eşik (5) çok hassastı — nefes/klavye/arka plan gürültüsünde bile
// konuşma halkası anlık yanıp sönüyordu. Eşik yükseltildi VE aşağıdaki
// "tracker" ile bir tür histerezis eklendi: (a) halka yalnızca art arda birkaç
// örnekte eşik üstü kalınırsa yanar (ani tek bir gürültüyle tetiklenmez),
// (b) ses eşiğin altına düşse de kısa bir süre (HOLD) yanık kalır (kelimeler
// arasındaki doğal duraklamalarda halka sönüp yanmasın).
const SPEAKING_VOLUME_THRESHOLD = 14;
const SPEAKING_ONSET_TICKS = 2; // ~200ms'lik örneklerden art arda kaç tanesi eşik üstü olmalı
const SPEAKING_HOLD_MS = 550; // eşik altına düşse de halka bu süre boyunca sönmez

// Agora'nın 'volume-indicator' olayını "hassas" tek örnekli ham veriden,
// kısa gürültü darbelerini filtreleyen ve doğal duraklamalarda flickerlamayan
// yumuşatılmış bir "konuşuyor" kümesine çeviren küçük durum makinesi.
// Her ses kanalı (gündüz/gece) için ayrı bir tracker örneği kullanılır.
function createSpeakingTracker() {
  const streaks = new Map(); // uid -> art arda eşik üstü örnek sayısı
  const lastConfirmedAt = new Map(); // uid -> son "konuşuyor" onaylanan zaman damgası
  return function update(volumes, resolveUid) {
    const now = Date.now();
    volumes.forEach(({ level, uid }) => {
      const id = resolveUid ? resolveUid(uid) : String(uid);
      if (level > SPEAKING_VOLUME_THRESHOLD) {
        const streak = (streaks.get(id) || 0) + 1;
        streaks.set(id, streak);
        if (streak >= SPEAKING_ONSET_TICKS) lastConfirmedAt.set(id, now);
      } else {
        streaks.set(id, 0);
      }
    });
    const speaking = new Set();
    lastConfirmedAt.forEach((ts, id) => {
      if (now - ts < SPEAKING_HOLD_MS) speaking.add(id);
    });
    return speaking;
  };
}

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

export function useVoiceChat({ appId, roomCode, userId, myRole, phase, isAlive = true }) {
  const [micError, setMicError] = useState('');
  const [dayMicOn, setDayMicOn] = useState(false);
  const [nightMicOn, setNightMicOn] = useState(false);
  const [joined, setJoined] = useState(false);
  // Oyuncunun kendi tercihi: gündüz/gece genel kanalda mikrofonunu kendi
  // isteğiyle kapatmış mı? Elenince bu tercihin üzerine ZORUNLU susturma biner.
  const [dayMicManuallyOff, setDayMicManuallyOff] = useState(false);
  // "Sesi kapat" (deafen) — sadece kendi tarafında, başkalarının seni duymasını
  // etkilemez, sadece SEN başkalarını duymuyorsun.
  const [deafened, setDeafened] = useState(false);
  // Şu an konuşmakta olan oyuncuların userId listesi (gündüz + gizli kanal birleşik).
  const [daySpeaking, setDaySpeaking] = useState(new Set());
  const [nightSpeaking, setNightSpeaking] = useState(new Set());

  const dayClientRef = useRef(null);
  const nightClientRef = useRef(null);
  const localTrackRef = useRef(null);
  const nightJoinedRef = useRef(false);
  const deafenedRef = useRef(false);
  const remoteTracksRef = useRef(new Map()); // uid -> uzak ses track'i (deafen aç/kapa için)
  const daySpeakingTrackerRef = useRef(createSpeakingTracker());
  const nightSpeakingTrackerRef = useRef(createSpeakingTracker());

  const isAssassin = ASSASSIN_ROLES.includes(myRole);
  const speakingUserIds = useMemo(() => new Set([...daySpeaking, ...nightSpeaking]), [daySpeaking, nightSpeaking]);

  // ---------- Gündüz kanalına bağlan (herkes, oda açıldığı anda) ----------
  useEffect(() => {
    if (!appId || !roomCode || !userId) return;
    let cancelled = false;

    async function connect() {
      try {
        const AgoraRTC = (await import('agora-rtc-sdk-ng')).default;
        const dayClient = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
        dayClientRef.current = dayClient;

        // ÖNEMLİ: `publish()` sadece KENDİ sesini gönderir — DİĞER oyuncuların
        // seslerini duymak için onların yayınına ayrıca "abone" olup çalmamız
        // (play) gerekir. Bu dinleyiciyi join()'den ÖNCE kuruyoruz ki kanala
        // girer girmez tetiklenen olayları kaçırmayalım.
        dayClient.on('user-published', async (remoteUser, mediaType) => {
          if (mediaType !== 'audio') return;
          try {
            const remoteTrack = await dayClient.subscribe(remoteUser, mediaType);
            remoteTrack.play();
            remoteTracksRef.current.set(remoteUser.uid, remoteTrack);
            if (deafenedRef.current) remoteTrack.setVolume(0);
          } catch (err) {
            console.error('Genel kanal — uzak ses aboneliği başarısız:', err);
          }
        });
        dayClient.on('user-unpublished', (remoteUser) => {
          remoteTracksRef.current.delete(remoteUser.uid);
        });

        const localTrack = await AgoraRTC.createMicrophoneAudioTrack();
        if (cancelled) {
          localTrack.close();
          return;
        }
        localTrackRef.current = localTrack;
        localTrack.setMuted(true); // faz/ölüm mantığı henüz devrede değil, varsayılan kapalı

        // Agora projesi "sertifikalı" (güvenli) modda olduğu için App ID'yi
        // token'sız kullanamıyoruz — backend'den bu kanala özel bir RTC token isteriz.
        const dayChannel = `${roomCode}-day`;
        const { token: dayToken } = await fetchVoiceToken(getToken(), dayChannel);

        await dayClient.join(appId, dayChannel, dayToken, userId);
        await dayClient.publish(localTrack);

        // Kim konuşuyor göstergesi: Agora her ~200ms'de bir yayındaki tüm
        // kullanıcılar (kendimiz dahil) için ses seviyesi bildirir.
        dayClient.enableAudioVolumeIndicator();
        dayClient.on('volume-indicator', (volumes) => {
          setDaySpeaking(daySpeakingTrackerRef.current(volumes));
        });

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
      remoteTracksRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId, roomCode, userId]);

  // ---------- Ölünce genel kanalda ZORUNLU sustur ----------
  // ÖNEMLİ: `joined` de bağımlılıklarda olmalı. Aksi halde şu senaryoda mikrofon
  // SÜREKLİ kapalı kalır ve kimse duyamaz: effect1 track'i asenkron oluşturduğu
  // için bu effect ilk render'da track henüz yokken bir kere çalışıp hiçbir şey
  // yapmadan çıkar; track daha sonra oluşturulunca bir daha tetiklenmezse
  // effect1'in koyduğu varsayılan "muted: true" durumunda kilitli kalır.
  useEffect(() => {
    const track = localTrackRef.current;
    if (!track) return;
    const isDead = isAlive === false; // zorunlu durum: elenen oyuncu artık konuşamaz
    const shouldBeMuted = isDead || dayMicManuallyOff;
    track.setMuted(shouldBeMuted);
    setDayMicOn(!shouldBeMuted);
  }, [phase, joined, dayMicManuallyOff, isAlive]);

  // ---------- Ölünce GİZLİ (suikastçı) kanalda da ZORUNLU sustur ----------
  // Yukarıdaki effect sadece genel/gündüz kanalını susturuyordu — bir suikastçı
  // ölmeden ÖNCE gizli kanalda mikrofonunu açık bırakmışsa, öldükten sonra da
  // yayın yapmaya devam ederdi (kimse "konuşamasın" beklentisini karşılamazdı).
  // toggleNightMic zaten `isAlive===false` iken YENİDEN açılmayı reddediyor;
  // burada eksik olan, ZATEN AÇIK olan yayını öldüğü anda kapatmaktı.
  useEffect(() => {
    if (isAlive !== false) return;
    const nightClient = nightClientRef.current;
    if (nightClient && nightMicOn) {
      nightClient.unpublish().catch(() => {});
      setNightMicOn(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAlive]);

  // Oyuncu kendi mikrofonunu istediği zaman açıp kapatabilir — ama elendiyse
  // (isAlive=false) bu zorunlu susturmayı ezemez.
  function toggleDayMic() {
    if (isAlive === false) return;
    setDayMicManuallyOff((prev) => !prev);
  }

  // "Sesi kapat" (deafen): başkalarının seni duymasını etkilemez, sadece SEN
  // başkalarını duymazsın — mikrofon kapatmanın yanına eklenen ayrı bir düğme.
  function toggleDeafen() {
    setDeafened((prev) => {
      const next = !prev;
      deafenedRef.current = next;
      remoteTracksRef.current.forEach((track) => {
        try {
          track.setVolume(next ? 0 : 100);
        } catch {
          // sessizce yut — track kapanmış olabilir
        }
      });
      return next;
    });
  }

  // ---------- Suikastçılar için gizli gece kanalına (bir kez) katıl ----------
  useEffect(() => {
    if (!isAssassin || !appId || !roomCode || !userId || nightJoinedRef.current) return;
    let cancelled = false;

    async function joinNightChannel() {
      try {
        const AgoraRTC = (await import('agora-rtc-sdk-ng')).default;
        const nightClient = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });

        // Aynı sebep: gizli kanaldaki diğer suikastçının sesini duymak için
        // onun yayınına abone olmamız gerekiyor.
        nightClient.on('user-published', async (remoteUser, mediaType) => {
          if (mediaType !== 'audio') return;
          try {
            const remoteTrack = await nightClient.subscribe(remoteUser, mediaType);
            remoteTrack.play();
            remoteTracksRef.current.set(remoteUser.uid, remoteTrack);
            if (deafenedRef.current) remoteTrack.setVolume(0);
          } catch (err) {
            console.error('Gizli kanal — uzak ses aboneliği başarısız:', err);
          }
        });
        nightClient.on('user-unpublished', (remoteUser) => {
          remoteTracksRef.current.delete(remoteUser.uid);
        });

        const nightChannel = `${roomCode}-night-assassins`;
        const { token: nightToken } = await fetchVoiceToken(getToken(), nightChannel);
        const nightUid = `${userId}${NIGHT_UID_SUFFIX}`;
        await nightClient.join(appId, nightChannel, nightToken, nightUid);

        nightClient.enableAudioVolumeIndicator();
        nightClient.on('volume-indicator', (volumes) => {
          const speaking = nightSpeakingTrackerRef.current(volumes, (uid) => {
            const raw = String(uid);
            return raw.endsWith(NIGHT_UID_SUFFIX) ? raw.slice(0, -NIGHT_UID_SUFFIX.length) : raw;
          });
          setNightSpeaking(speaking);
        });

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
    if (!track || !nightClient || isAlive === false) return;
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
    deafened,
    toggleDeafen,
    speakingUserIds,
    isAssassin,
    toggleNightMic,
    toggleDayMic,
    canToggleDayMic: isAlive !== false,
    canUseNightChannel: isAssassin && phase === 'NIGHT' && isAlive !== false,
  };
}
