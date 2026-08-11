-- ============================================================
-- schema_v3_migration.sql — İleri seviye yönetici paneli + avatar
-- yükleme + yazılı sohbet + rol istatistikleri için gerekli alanlar.
-- Supabase SQL Editor'de bu dosyanın TAMAMINI çalıştır.
-- ============================================================

-- ---------- 1. Kullanıcı avatarı (kendi yükleyip admin onayı bekleyen) ----------
-- avatar_url zaten schema.sql'de vardı ama hiç kullanılmıyordu — artık
-- "onaylanmış / canlı" avatar resmi (data URI, base64) burada tutulacak.
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_pending_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_status VARCHAR(16) NOT NULL DEFAULT 'NONE';
-- avatar_status: 'NONE' (hiç yüklemedi) | 'PENDING' (onay bekliyor) | 'APPROVED' | 'REJECTED'

-- ---------- 2. Yönetici hiyerarşisi ----------
-- is_owner = TRUE olan hesap (tek bir hesap, sen) sınırsız yetkiye sahip:
-- başka hesapları admin yapabilir/admin'likten alabilir, hesap silebilir.
-- is_admin = TRUE olan (owner dahil) normal admin panelini kullanabilir ama
-- promote/delete gibi tehlikeli işlemler SADECE is_owner'a açık.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_owner BOOLEAN NOT NULL DEFAULT FALSE;

-- ---------- 3. Profil kilidi (isim/fotoğraf yasağı) ----------
-- TRUE olduğunda kullanıcı kendi kullanıcı adını VEYA avatarını (emoji ya da
-- yüklenen fotoğraf) değiştiremez; sadece admin bu kilidi açabilir.
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_locked BOOLEAN NOT NULL DEFAULT FALSE;

-- Kendi hesabını owner yap (SADECE kendi e-postan için çalıştır, aşağıdaki satırın başındaki -- işaretini sil):
-- UPDATE users SET is_owner = TRUE, is_admin = TRUE WHERE email = 'mseyhanli@efa.org.tr';

-- ---------- 4. Hesap silme desteği: geçmiş maç kayıtları bozulmasın ----------
-- Bir hesap silindiğinde o hesabın oynadığı geçmiş maçların KAYDI silinmez;
-- sadece o oyuncuya olan referans NULL'a düşer (diğer oyuncuların maç geçmişi bozulmaz).
ALTER TABLE game_players DROP CONSTRAINT IF EXISTS game_players_user_id_fkey;
ALTER TABLE game_players ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE game_players
  ADD CONSTRAINT game_players_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE games DROP CONSTRAINT IF EXISTS games_host_user_id_fkey;
ALTER TABLE games
  ADD CONSTRAINT games_host_user_id_fkey
  FOREIGN KEY (host_user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE game_events DROP CONSTRAINT IF EXISTS game_events_actor_id_fkey;
ALTER TABLE game_events
  ADD CONSTRAINT game_events_actor_id_fkey
  FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE game_events DROP CONSTRAINT IF EXISTS game_events_target_id_fkey;
ALTER TABLE game_events
  ADD CONSTRAINT game_events_target_id_fkey
  FOREIGN KEY (target_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE game_votes DROP CONSTRAINT IF EXISTS game_votes_voter_id_fkey;
ALTER TABLE game_votes ALTER COLUMN voter_id DROP NOT NULL;
ALTER TABLE game_votes
  ADD CONSTRAINT game_votes_voter_id_fkey
  FOREIGN KEY (voter_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE game_votes DROP CONSTRAINT IF EXISTS game_votes_target_id_fkey;
ALTER TABLE game_votes
  ADD CONSTRAINT game_votes_target_id_fkey
  FOREIGN KEY (target_id) REFERENCES users(id) ON DELETE SET NULL;

-- ---------- 5. player_stats: kazanma/kaybetme sayacı artık dolduruluyor ----------
-- (Kolonlar zaten schema.sql'de vardı, sadece backend kodunda hiç güncellenmiyorlardı.
--  Burada ekstra bir migration adımı gerekmiyor, not olarak bırakıldı.)
