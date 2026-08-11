-- ============================================================
-- schema_v4_migration.sql — Round 5 güncellemeleri
-- Uygulama ayarları (gece/gündüz/oylama süresi, oda isimleri, rol dağılımları)
-- artık admin panelinden istenildiği zaman değiştirilebiliyor; adminlerin
-- hangi yetkilere sahip olduğu owner tarafından tek tek açılıp kapatılabiliyor.
-- Supabase SQL Editor'de ÇALIŞTIR.
-- ============================================================

-- ---------- 1. UYGULAMA AYARLARI (tek satır, id=1) ----------
CREATE TABLE IF NOT EXISTS app_settings (
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
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT app_settings_single_row CHECK (id = 1)
);

INSERT INTO app_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ---------- 2. ADMİN İZİNLERİ (owner tek tek açar/kapatır) ----------
-- Varsayılan '{}' = hiçbir yetkisi yok. Owner her admin için ayrı ayrı
-- (manage_users, delete_users, manage_rooms, review_avatars, edit_settings)
-- izinlerini açabilir. Owner'ın kendisi bu kontrolden bağımsız, her zaman
-- tam yetkilidir (bkz. backend/server.js hasPermission()).
ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_permissions JSONB NOT NULL DEFAULT '{}'::jsonb;
