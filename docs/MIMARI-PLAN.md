# "Sarayda Gece: Gizli Prenses" — Mimari Plan

Bu doküman, tarayıcı üzerinden oynanan gizli rol / sosyal çıkarım oyununun veritabanı şemasını, Socket.io olay mimarisini, önerilen teknoloji yığınını ve puanlama algoritmasını açıklar. Çalışan kod taslakları `backend/` klasöründe yer alır: `schema.sql`, `schema_v2_migration.sql`, `server.js`, `game/gameRoom.js`, `game/roles.js`, `game/scoring.js`, `voice-chat-example.js`; frontend `frontend/` klasöründe (bkz. Bölüm 7).

## 0. Oda Boyutları ve Rol Dengesi

Oyun artık 4, 6 veya 8 kişilik odalarda oynanabiliyor (`backend/game/roles.js` -> `ROLE_SETS_BY_SIZE`). Denge mantığı: her boyutta suikastçı oranı kabaca 1/3'ün altında tutulur; oyun küçüldükçe önce "ek/lüks" roller (Hekim, Taht Taliplisi) çıkarılır çünkü çekirdek mekanik (Gizli Prenses, Muhafız, Baş Casus, Gölge Lider) onlarsız da tam çalışır.

- **4 kişi:** Gizli Prenses, Muhafız, Baş Casus (3 iyi) + Gölge Lider (1 suikastçı)
- **6 kişi:** Gizli Prenses, Sahte Prenses, Muhafız, Baş Casus (4 iyi) + Gölge Lider, Zehirbaz (2 suikastçı)
- **8 kişi:** orijinal 8 rolün tamamı (5 iyi + 2 suikastçı + 1 tarafsız)

Oda kurucusu, oda oluştururken boyutu seçer (`createRoom` event'ine `{ roomSize }` parametresi eklendi); `GameRoom` bu boyutu oyun boyunca `roomSize` alanında tutar ve rol dağıtımı, lobi doluluk kontrolü buna göre çalışır.

## 1. Veritabanı Şeması

Şemanın tam SQL'i `backend/schema.sql` dosyasında. Buradaki mantık şu: **aktif bir maçın anlık durumu (kim hangi rolde, gece kimi seçti, oy sayımı) veritabanında değil, sunucunun RAM'inde (`GameRoom` sınıfı örneği) tutulur.** Bunun nedeni performans ve basitliktir — saniyeler içinde değişen bir durumu her adımda diske yazmak gereksiz gecikme yaratır. Veritabanı yalnızca kalıcı olması gereken şeyler için kullanılır: kullanıcı hesapları, geçmiş maç sonuçları ve istatistikler.

Ana tablolar:

**users** — kullanıcı adı, e-posta, bcrypt ile hashlenmiş şifre. Kayıt/giriş bu tablo üzerinden çalışır.

**player_stats** — her kullanıcı için toplam maç sayısı, galibiyet/mağlubiyet, toplam puan (liderlik tablosu bu alana göre sıralanır) ve galibiyet serisi. Her maç bitiminde tek bir `UPDATE` ile güncellenir.

**player_role_stats** — kullanıcının her rolle kaç kez oynadığı ve kazandığı (örn. "en çok Gölge Lider olarak kazanan oyuncular" gibi filtrelenebilir istatistikler için).

**games** — geçmişe dönük maç kayıtları: oda kodu, kurucu, kazanan taraf, başlama/bitiş zamanı. Maç RAM'de oynanır, bittiğinde tek satır olarak buraya yazılır.

**game_players** — bir maçtaki her oyuncunun koltuğu, aldığı rol, hayatta kalıp kalmadığı ve o maçtan kazandığı puan. Rol dağılımı istatistiklerinin kaynağı budur.

**game_events** — isteğe bağlı ama önerilir: her gece aksiyonu, oy ve idamın denetim kaydı (JSONB `payload` ile). "Maçı tekrar izleme" özelliği veya hile şüphesi araştırması ileride istenirse bu tablo olmadan mümkün değildir; en baştan eklemek çok ucuzdur.

**game_votes** — gündüz idam oylamasının kim-kime-oy-verdi kaydı.

**leaderboard** — `player_stats` üzerine kurulu bir VIEW; galibiyet oranını da hesaplayıp döndürür.

## 2. Socket.io Olay Mimarisi

Oyunun gerçek zamanlı kısmı tamamen Socket.io üzerinden yürür; REST API sadece kayıt/giriş ve istatistik/liderlik tablosu okuma gibi "anlık olmayan" işler içindir.

Bağlantı kimlik doğrulaması `io.use()` middleware'inde JWT ile yapılır (bkz. `server.js`), böylece her socket'e `socket.user = { userId, username }` bağlanır ve olay işleyicilerinde tekrar kimlik sorgusu yapmaya gerek kalmaz.

### İstemci → Sunucu

| Event | Ne zaman | Payload |
|---|---|---|
| `createRoom` | Oda kurucu yeni oda açar | — |
| `joinRoom` | Davet kodu ile odaya katılma | `{ roomCode }` |
| `leaveRoom` | Lobiden/odadan çıkma | — |
| `startGame` | Kurucu 8 kişi tamamlanınca başlatır | — |
| `useAbility` | Gece yeteneği kullanımı | `{ abilityKey, targetUserId, mode? }` |
| `castVote` | Gündüz idam oyu | `{ targetUserId \| null }` |
| `claimPrincess` | Gizli Prenses kartını açıp idamı iptal eder | `{ pendingExecutionTargetUserId }` |

### Sunucu → İstemci

| Event | Ne zaman | Payload |
|---|---|---|
| `roomUpdate` | Lobi değişti (biri katıldı/çıktı) | `{ players, hostUserId, phase }` |
| `gameStarted` | Oyun başladı — **sadece o oyuncuya özel** gönderilir | `{ yourRole, team }` |
| `phaseChanged` | Gece/gündüz/oylama fazı değişti | `{ phase, dayNumber }` |
| `abilityResult` | Özel yetenek sonucu (casus, sorgu) — sadece ilgili oyuncuya | `{ abilityKey, targetUserId, result }` |
| `nightResult` | Sabah, gece ölümleri herkese açıklanır | `{ deaths: [{ userId, cause }] }` |
| `voteUpdate` | Oylama anlık sayımı | `{ votes: { userId: oySayisi } }` |
| `pendingExecution` | Oylama bitti, idam kesinleşmeden önce ~15 sn'lik bekleme penceresi başladı | `{ targetUserId }` |
| `executionResult` | İdam sonucu ve rol ifşası | `{ userId, roleReveal }` |
| `princessRevealed` | Prenses kartını açtı, idam iptal | `{ userId }` |
| `gameEnded` | Maç bitti | `{ winningTeam, roleReveal }` |
| `voicePhaseChanged` | Ses altyapısına faz sinyali (mute/kanal geçişi tetikler) | `{ phase }` |
| `error` | Geçersiz istek | `{ message }` |

Önemli tasarım kararı: rol bilgisi (`gameStarted`) ve casus/sorgu sonuçları (`abilityResult`) **broadcast değil, `io.to(socket.id).emit(...)` ile tek bir sokete** gönderilir. Bu, "herkes herkesin rolünü console'dan görebilir" gibi bariz bir hile açığını en baştan kapatır — istemci tarafı kodu ne kadar iyi yazılırsa yazılsın, sunucu bilgiyi hiç göndermezse sızdırılamaz.

## 3. Oda ve Lobi Sistemi

Oda kodu üretimi (`generateRoomCode` fonksiyonu, `server.js`) karışabilecek karakterleri (0/O, 1/I) dışlayan 6 karakterlik bir kod üretir (örn. `X7K9P2`), tıpkı istenen formatta. Aktif odalar `Map<roomCode, GameRoom>` içinde tutulur; bir maç bittiğinde veya son oyuncu ayrıldığında bellekten silinir, böylece sunucu kalıcı olarak şişmez.

Lobi ekranı `roomUpdate` event'ini dinleyip oyuncu listesini ve "8/8 oyuncu — Başlat" durumunu gösterir. `startGame` yalnızca `hostUserId` tarafından tetiklenebilir; sunucu bunu tekrar doğrular (istemci tarafı kontrolüne güvenilmez).

## 4. Sesli İletişim Mimarisi

Kod örneği: `backend/voice-chat-example.js` (frontend tarafında React hook'u olarak).

Ham WebRTC mesh (her oyuncunun diğer 7'siyle doğrudan bağlantı kurması) 8 kişide 28 eşzamanlı bağlantı anlamına gelir; NAT/güvenlik duvarı arkasındaki oyuncular için TURN sunucusu şart olur ve "gece fazında suikastçıları ayrı bir kanala al" gibi dinamik grup geçişlerini elle yönetmek karmaşıklaşır. Bu yüzden önerim **Agora RTC SDK** (aylık 10.000 dakika ücretsiz katman, küçük bir arkadaş grubu için fazlasıyla yeterli) veya **Daily.co** kullanmak; ikisi de SFU mimarisiyle ICE/TURN/bant genişliği yönetimini üstlenir.

Mantık iki ayrı sesli kanal üzerine kurulu: `{roomCode}-day` (tüm oyuncular) ve `{roomCode}-night-assassins` (sadece Gölge Lider + Zehirbaz). Sunucudan gelen `phaseChanged` event'i `NIGHT` olduğunda istemci `day` kanalındaki mikrofonu otomatik `setMuted(true)` yapar; `DAY_DISCUSSION`/`DAY_VOTE` fazına geçince tekrar açar. Suikastçılar gece boyunca kendi gizli kanallarında bas-konuş (push-to-talk) ile fısıldaşabilir — bu kanal diğer oyunculara hiç görünmez çünkü onlar o kanala hiç `join` olmaz.

Kritik güvenlik notu: mute/unmute kararını **asla sadece istemciye bırakmayın** — sunucu tarafında `phaseChanged` otoriter kaynaktır; istemci kodu manipüle edilse bile (örn. tarayıcı konsolundan `setMuted(false)` zorlanırsa) hangi Agora kanalına `join` olunabildiği sunucu tarafından imzalanan bir token ile sınırlandırılır.

**Token tabanlı kimlik doğrulama (uygulandı):** Agora projesi "Primary Certificate" etkin (güvenli mod) olduğu için App ID'yi token'sız kullanmak `CAN_NOT_GET_GATEWAY_SERVER: dynamic use static key` hatası verir. Backend'de `GET /api/voice/token?channelName=...` (JWT ile korumalı) endpoint'i, `agora-token` paketiyle `AGORA_APP_CERTIFICATE` (sadece Render ortam değişkeni, istemciye asla gönderilmez) kullanarak `uid=0` ("wildcard" — o kanala hangi uid ile katılırsa katılsın geçerli) bir RTC token üretir; `frontend/lib/voice.js` her iki kanala (`day` ve `night-assassins`) katılmadan önce bu endpoint'i çağırıp gerçek token ile `join()` yapar. Backend ortam değişkenleri: `AGORA_APP_ID` ve `AGORA_APP_CERTIFICATE` (Agora Console > Project Management > Config'te görünür).

## 5. Teknoloji Yığını Önerisi (Ücretsiz/Uygun Maliyetli Deploy)

| Katman | Öneri | Neden |
|---|---|---|
| Frontend | Next.js → **Vercel** | Ücretsiz katman, otomatik CI/CD, statik + client-side oyun ekranı için ideal |
| Backend (Socket.io) | Node.js/Express → **Render** (Web Service, ücretsiz katman) | Vercel'in serverless fonksiyonları kalıcı WebSocket bağlantısını desteklemez; Render/Railway/Fly.io gibi "her zaman açık süreç" barındıran platformlar gerekir |
| Veritabanı | **Supabase** (yönetilen PostgreSQL, ücretsiz katman) | İlişkisel bütünlük (kullanıcı-istatistik-maç ilişkileri) + hazır SQL editörü + gerekirse yerleşik Auth'a geçiş kolaylığı |
| Ses altyapısı | **Agora RTC** (10.000 dk/ay ücretsiz) veya **Daily.co** | SFU mimarisi, TURN/ICE yönetimini üstlenir, kanal bazlı gece/gündüz ayrımı kolay |
| Kimlik doğrulama | JWT (kendi implementasyonu, `bcryptjs` + `jsonwebtoken`) | Basit, bağımsız; istenirse NextAuth.js'e geçiş kolay |

Not: Render'ın ücretsiz web servisleri belirli bir süre trafik almazsa uykuya geçer (cold start ~30-60 sn). Arkadaş grubu oyunuysa bu kabul edilebilir; eğer "her an anında açılsın" isteniyorsa Railway'in ücretsiz/hobi katmanı veya küçük bir ücretli Render planı düşünülebilir.

## 6. Puanlama Sistemi Algoritması

Tam kod: `backend/game/scoring.js` (`calculateMatchScores` fonksiyonu). Formülün mantığı:

Her oyuncu maça katıldığı için **2 taban puan** alır (katılım motive edici olsun, tamamen puansız kalınmasın diye). Kazanan tarafın her üyesi **+20 takım galibiyeti puanı** alır; **Taht Taliplisi tek başına kazanırsa +50 puan** alır çünkü tek başına hem Prensesi hem diğer herkesi geride bırakması istatistiksel olarak çok daha zor bir koşuldur. Maç sonunda hayatta kalan her oyuncu (kazansın kaybetsin) **+3 hayatta kalma bonusu** alır — bu, "hemen öldüm, oyunun kalanını izledim" ile "sonuna kadar aktif oynadım" arasında küçük bir fark yaratır. Gizli Prenses, kimliğini hiç açık etmeden veya açık edip idamı iptal ettirerek hayatta kalmışsa ve İyiler kazandıysa **+10 ek puan**; Sahte Prenses görevini yaparak suikastçılar tarafından öldürülmüşse (yani "yem" rolünü gerçekten oynamışsa) **+8 ek puan** alır — bu iki bonus, "pasif hayatta kalma" ile "rolünü doğru oynama"yı ayırt eder.

Son olarak her rolün toplam puanı, o rolün ortalama risk/sorumluluk seviyesine göre küçük bir çarpanla ağırlıklandırılır (Gizli Prenses ×1.3, Gölge Lider ×1.2, Hekim/Zehirbaz ×1.1, Muhafız/Baş Casus ×1.05, diğerleri ×1.0). Bu çarpanlar keyfi değil; amaç, daha fazla karar sorumluluğu taşıyan rollerin (yanlış oynandığında takımı daha çok zarar verebilen roller) doğru oynandığında biraz daha ödüllendirilmesidir. Sezon sonunda dengesizlik görülürse (örn. bir rol sürekli aşırı puan topluyorsa) bu çarpanlar tek bir yerden (`ROLE_MULTIPLIER` objesi) kolayca ayarlanabilir — algoritmanın geri kalanına dokunmaya gerek kalmaz.

Örnek hesap: İyiler kazandı, Gizli Prenses hayatta kaldı → (2 katılım + 20 takım galibiyeti + 3 hayatta kalma + 10 prenses bonusu) × 1.3 = 35 × 1.3 ≈ **46 puan**. Taht Taliplisi tek başına kazandı ve hayatta kaldı → (2 + 50 + 3) × 1.0 = **55 puan**.

## 6.5 Host Kontrolleri ve Site Geneli Admin Paneli

**Oda içi host kontrolleri** (`gameRoom.js` -> `kickPlayer`, `abortGame`; socket event'leri `kickPlayer`, `abortGame`): oda kurucusu lobi fazındayken bir oyuncuyu atabilir; aktif bir maçı da (herhangi bir fazda) erken bitirip odayı lobiye döndürebilir — oyuncular korunur, roller/faz sıfırlanır, yeniden "Oyunu Başlat" ile devam edilebilir.

**Site geneli admin paneli** sadece `users.is_admin = true` olan hesaplara açık (JWT içine "isAdmin" claim'i gömmek yerine her istekte DB'den taze okunuyor — `adminMiddleware`, bkz. `server.js` — böylece bir hesabın yetkisi geri alındığında eski token'lar hâlâ geçerli olsa da erişim anında kesiliyor). Uç noktalar: `GET /api/admin/users` (tüm kullanıcılar + istatistikleri), `POST /api/admin/users/:userId/ban` (yasakla/yasağı kaldır — yasaklı hesap login'de reddedilir), `GET /api/admin/rooms` (RAM'deki aktif odaların anlık özeti), `POST /api/admin/rooms/:roomCode/end` (bir odayı zorla sonlandırır). İlk admin hesabını oluşturmak için `schema_v2_migration.sql`'in altındaki `UPDATE users SET is_admin = TRUE WHERE email = '...'` satırını kendi e-postanla Supabase SQL Editor'de çalıştırman gerekiyor — arayüzden admin yapma özelliği bilinçli olarak yok, ilk admin elle atanır.

## 6.6 Profil ve Hesap Ayarları

`GET /api/profile/me` ve `PATCH /api/profile/me` ile kullanıcı adı ve avatar (10 emoji arasından seçilen basit bir avatar — dosya yükleme/depolama altyapısı gerektirmeden) düzenlenebiliyor. `POST /api/auth/change-password` ile şifre değiştirme (mevcut şifre doğrulanarak) eklendi. Bu üçü de `frontend/app/profile` ve `frontend/app/settings` sayfalarında kullanılıyor.

## 7. Frontend (Next.js)

`frontend/` klasöründe çalışan bir Next.js (App Router) istemcisi var: kayıt/giriş sayfaları (`app/login`, `app/register`), lobi (`app/lobby` — oda boyutu seçimi dahil), oyunun oynandığı oda ekranı (`app/room/[roomCode]`), profil (`app/profile`), hesap ayarları (`app/settings`), liderlik tablosu (`app/leaderboard`) ve yönetici paneli (`app/admin`, sadece `user.isAdmin` true olan hesaplara görünür — asıl yetki kontrolü sunucuda). Oda ekranı, backend'in yayınladığı tüm Socket.io event'lerini dinler, role göre gece yeteneği formunu (Muhafız/Hekim/Casus/Gölge Lider/Zehirbaz) dinamik gösterir ve `components/SeatTable.js` ile tüm oyuncuları yuvarlak bir masa etrafında "sandalyelerde" (avatar + isim, ölüler soluk/çizili) görselleştirir — bu bileşen oyuncu sayısına göre otomatik açı hesapladığı için 4/6/8 kişilik odaların hepsinde çalışır. `lib/socket.js` tek bir Socket.io bağlantısını (singleton) yönetir, `lib/auth.js` JWT'yi tarayıcıda saklar. Vercel'e deploy ederken `NEXT_PUBLIC_BACKEND_URL` ortam değişkenini Render'daki backend URL'ine ayarlamak gerekiyor.

Not: İdam mekaniği başlangıçtaki taslakta doğrudan oylama biter bitmez idam ediyordu; Gizli Prenses'in kartını açıp iptal edebilmesi için bir ara faz (`PENDING_EXECUTION`, ~15 sn) eklendi — oylama bitince önce bu faza geçilir, hedef Prenses ise ve süresi içinde `claimPrincess` gönderirse idam iptal olur, göndermezse süre sonunda otomatik idam gerçekleşir.

## 8. Sıradaki Adımlar

Production'a almadan önce şu noktalar tamamlanmalı: reconnect/disconnect durumunda oyuncunun oyuna geri dönebilmesi (sayfa yenilendiğinde `joinRoom` tekrar gönderiliyor; lobi fazında artık güvenli — bkz. `addPlayer`'daki idempotent kontrol — ama oyun ortasında sayfa yenilemesi hâlâ "Oyun zaten başladı" hatasına düşer), Agora/Daily.co için sunucu taraflı kanal token'ı üretimi (güvenlik), gece fazı yetenek sırası çakışmalarının (örn. Zehirbaz'ın kilitlediği rolün aynı gece aksiyon göndermeye çalışması) daha kapsamlı test edilmesi, ve `game_events` tablosunun gerçekten her aksiyonda yazılması (taslakta sadece şema var, `server.js`/`gameRoom.js` içine `INSERT` çağrıları eklenmeli).
