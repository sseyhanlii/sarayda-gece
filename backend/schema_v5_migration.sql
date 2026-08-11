-- ============================================================
-- schema_v5_migration.sql — Round 6 güncellemesi
-- Owner/yetkili admin artık admin panelinden rollerin GÖRÜNEN İSİMLERİNİ
-- (label) değiştirebiliyor — bu Supabase'de saklanan tek yeni sütun.
-- Supabase SQL Editor'de ÇALIŞTIR (schema_v4_migration.sql'den SONRA,
-- eğer onu daha önce çalıştırmadıysan önce onu çalıştır).
-- ============================================================

ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS role_labels JSONB NOT NULL DEFAULT '{}'::jsonb;
