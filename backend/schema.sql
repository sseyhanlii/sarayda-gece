-- ============================================================
-- "Sarayda Gece: Gizli Prenses" - PostgreSQL Şeması
-- Önerilen barındırma: Supabase / Render Postgres / Railway
-- ============================================================

-- ---------- 1. KULLANICILAR ----------
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username        VARCHAR(24)  UNIQUE NOT NULL,
    email           VARCHAR(255) UNIQUE NOT NULL,
    password_hash   TEXT NOT NULL,          -- bcrypt hash
    avatar_url      TEXT,                   -- onaylanmış/canlı avatar (emoji ya da yüklenen fotoğraf, data URI)
    avatar_emoji    VARCHAR(8) DEFAULT '👤', -- basit emoji avatar (dosya yükleme altyapısı gerektirmez)
    avatar_pending_url TEXT,                 -- kullanıcının yüklediği, henüz admin onayı bekleyen fotoğraf
    avatar_status   VARCHAR(16) NOT NULL DEFAULT 'NONE', -- NONE | PENDING | APPROVED | REJECTED
    is_admin        BOOLEAN NOT NULL DEFAULT FALSE, -- site geneli admin paneline erişim
    is_owner        BOOLEAN NOT NULL DEFAULT FALSE, -- tek hesap: sınırsız yetki (admin atama/silme dahil)
    is_banned       BOOLEAN NOT NULL DEFAULT FALSE, -- true ise giriş engellenir
    profile_locked  BOOLEAN NOT NULL DEFAULT FALSE, -- true ise kullanıcı ad/avatarını kendi değiştiremez
    admin_permissions JSONB NOT NULL DEFAULT '{}'::jsonb, -- owner'ın admin'e tek tek verdiği izinler
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at   TIMESTAMPTZ
);

-- Uygulama geneli ayarlar (gece/gündüz/oylama süresi, oda isimleri, rol
-- dağılımları) — admin panelinden istenildiği zaman değiştirilebilir.
CREATE TABLE app_settings (
    id                 SMALLINT PRIMARY KEY DEFAULT 1,
    night_duration_ms  INTEGER NOT NULL DEFAULT 20000,
    day_duration_ms    INTEGER NOT NULL DEFAULT 40000,
    vote_duration_ms   INTEGER NOT NULL DEFAULT 15000,
    room_names         JSONB NOT NULL DEFAULT '{"4":"Fenerlikız Odası","6":"Pizza Odası","8":"Zeygen Odası"}'::jsonb,
    role_sets          JSONB NOT NULL DEFAULT '{
        "4": ["GIZLI_PRENSES","MUHAFIZ","BAS_CASUS","GOLGE_LIDER"],
        "6": ["GIZLI_PRENSES","SAHTE_PRENSES","MUHAFIZ","BAS_CASUS","GOLGE_LIDER","ZEHIRBAZ"],
        "8": ["GIZLI_PRENSES","SAHTE_PRENSES","MUHAFIZ","HEKIM","BAS_CASUS","GOLGE_LIDER","ZEHIRBAZ","TAHT_TALIPLISI"]
    }'::jsonb,
    -- Rollerin varsayılan Türkçe etiketinin üzerine owner'ın yazdığı özel
    -- isimler (boş obje = hepsi varsayılan) — bkz. schema_v5_migration.sql.
    role_labels        JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT app_settings_single_row CHECK (id = 1)
);

INSERT INTO app_settings (id) VALUES (1);

-- ---------- 2. OYUNCU İSTATİSTİKLERİ ----------
-- Genel toplamlar burada; role-özel dağılım player_role_stats'ta.
CREATE TABLE player_stats (
    user_id             UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    total_games         INTEGER NOT NULL DEFAULT 0,
    total_wins          INTEGER NOT NULL DEFAULT 0,
    total_losses        INTEGER NOT NULL DEFAULT 0,
    total_score         INTEGER NOT NULL DEFAULT 0,   -- Liderlik tablosu bu alana göre sıralanır
    current_win_streak  INTEGER NOT NULL DEFAULT 0,
    best_win_streak     INTEGER NOT NULL DEFAULT 0,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Rol bazlı dağılım (hangi rolle kaç kez oynadı / kazandı) - liderlik tablosunda
-- "en çok X rolüyle kazanan" gibi filtreler için kullanılabilir.
CREATE TABLE player_role_stats (
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    role_key    VARCHAR(32) NOT NULL,   -- 'GIZLI_PRENSES','SAHTE_PRENSES','MUHAFIZ', ...
    games_played INTEGER NOT NULL DEFAULT 0,
    wins        INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, role_key)
);

-- ---------- 3. ODALAR / MAÇLAR ----------
CREATE TYPE game_status AS ENUM ('LOBBY','IN_PROGRESS','FINISHED','ABORTED');
CREATE TYPE game_phase  AS ENUM ('LOBBY','NIGHT','DAY_DISCUSSION','DAY_VOTE','EXECUTION','RESULTS');

CREATE TABLE games (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_code       VARCHAR(8) UNIQUE NOT NULL,     -- örn. "X7K9P2"
    host_user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
    status          game_status NOT NULL DEFAULT 'LOBBY',
    current_phase   game_phase  NOT NULL DEFAULT 'LOBBY',
    day_number      INTEGER NOT NULL DEFAULT 0,
    winner_team     VARCHAR(16),                    -- 'IYILER' | 'SUIKASTCILAR' | 'TAHT_TALIPLISI'
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at      TIMESTAMPTZ,
    ended_at        TIMESTAMPTZ
);

-- Bir maçtaki her koltuk/oyuncu ve aldığı rol (maç bitince stats'a işlenir)
CREATE TABLE game_players (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id         UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL, -- hesap silinirse NULL'a düşer, kayıt kalır
    seat_number     SMALLINT NOT NULL,              -- 1-8
    role_key        VARCHAR(32) NOT NULL,
    is_alive        BOOLEAN NOT NULL DEFAULT TRUE,
    died_on_day     INTEGER,                        -- hangi gün/gece öldü (null = hayatta)
    died_cause      VARCHAR(32),                     -- 'SUIKAST','IDAM','ZEHIR'
    score_delta     INTEGER,                         -- bu maçtan kazandığı/kaybettiği puan
    UNIQUE (game_id, seat_number)
);

-- Gece/gündüz olaylarının denetim kaydı (replay, anti-cheat, debug için)
CREATE TABLE game_events (
    id          BIGSERIAL PRIMARY KEY,
    game_id     UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    day_number  INTEGER NOT NULL,
    phase       game_phase NOT NULL,
    event_type  VARCHAR(32) NOT NULL,   -- 'ABILITY_USED','VOTE_CAST','EXECUTION','DEATH','PRINCESS_REVEAL'
    actor_id    UUID REFERENCES users(id) ON DELETE SET NULL,
    target_id   UUID REFERENCES users(id) ON DELETE SET NULL,
    payload     JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Gündüz oylama kayıtları (idam oylaması)
CREATE TABLE game_votes (
    id          BIGSERIAL PRIMARY KEY,
    game_id     UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    day_number  INTEGER NOT NULL,
    voter_id    UUID REFERENCES users(id) ON DELETE SET NULL,
    target_id   UUID REFERENCES users(id) ON DELETE SET NULL,   -- null = çekimser
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (game_id, day_number, voter_id)
);

-- ---------- 4. İNDEKSLER ----------
CREATE INDEX idx_games_room_code ON games(room_code);
CREATE INDEX idx_game_players_game ON game_players(game_id);
CREATE INDEX idx_game_events_game ON game_events(game_id);
CREATE INDEX idx_stats_score ON player_stats(total_score DESC);

-- ---------- 5. LİDERLİK TABLOSU VIEW ----------
CREATE VIEW leaderboard AS
SELECT u.id, u.username, u.avatar_url,
       ps.total_score, ps.total_games, ps.total_wins, ps.total_losses,
       ROUND(100.0 * ps.total_wins / GREATEST(ps.total_games,1), 1) AS win_rate
FROM users u
JOIN player_stats ps ON ps.user_id = u.id
ORDER BY ps.total_score DESC;
