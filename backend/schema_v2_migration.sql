-- ============================================================
-- schema_v2_migration.sql — Profil düzenleme, hesap ayarları ve
-- site geneli admin paneli için gereken ek sütunlar.
-- schema.sql'i zaten çalıştırdıysan, bunu Supabase SQL Editor'de
-- BİR KEZ ek olarak çalıştır (schema.sql'i tekrar çalıştırman gerekmiyor).
-- ============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_emoji VARCHAR(8) DEFAULT '👤';
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_banned BOOLEAN NOT NULL DEFAULT FALSE;

-- Kendi hesabını yönetici yapmak için (e-postanı aşağıda kendi e-postanla değiştir):
-- UPDATE users SET is_admin = TRUE WHERE email = 'mseyhanli@efa.org.tr';
