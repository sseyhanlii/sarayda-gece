-- ============================================================
-- schema_v6_migration.sql — Round 8 düzeltmesi
-- BUG: "Aşko" rolü eklendiğinde hiçbir oda boyutunun varsayılan rol dağılımına
-- dahil edilmemişti — rolün kendisi tam çalışıyordu ama hiçbir maçta gerçekten
-- dağıtılmıyordu ("Aşko rolü hangi masada? yok" şikayeti). Bu, 6 ve 8 kişilik
-- setlerde SAHTE_PRENSES'in yerine ASKO ekler.
--
-- NOT: Bu migration'ı çalıştırmak ZORUNLU DEĞİL — aynı sonucu admin panelinden
-- (Oyun Ayarları > Rol Dağılımları) "Aşko" kutusunu işaretleyip "Sahte Prenses"
-- kutusunun işaretini kaldırıp Kaydet'e basarak da alabilirsin, redeploy bile
-- gerekmez. Bu SQL sadece bunu tek komutla yapmanın kısayolu.
--
-- GÜVENLİ: sadece satır HÂLÂ eski varsayılan değerdeyse günceller — eğer daha
-- önce admin panelinden rol dağılımını kendi isteğine göre değiştirdiysen bu
-- migration hiçbir şeyi EZMEZ (WHERE koşulu eşleşmez, sessizce hiçbir satır
-- güncellenmez).
-- ============================================================

UPDATE app_settings
SET role_sets = '{
    "4": ["GIZLI_PRENSES","MUHAFIZ","BAS_CASUS","GOLGE_LIDER"],
    "6": ["GIZLI_PRENSES","ASKO","MUHAFIZ","BAS_CASUS","GOLGE_LIDER","ZEHIRBAZ"],
    "8": ["GIZLI_PRENSES","ASKO","MUHAFIZ","HEKIM","BAS_CASUS","GOLGE_LIDER","ZEHIRBAZ","TAHT_TALIPLISI"]
}'::jsonb,
    updated_at = now()
WHERE id = 1
  AND role_sets = '{
    "4": ["GIZLI_PRENSES","MUHAFIZ","BAS_CASUS","GOLGE_LIDER"],
    "6": ["GIZLI_PRENSES","SAHTE_PRENSES","MUHAFIZ","BAS_CASUS","GOLGE_LIDER","ZEHIRBAZ"],
    "8": ["GIZLI_PRENSES","SAHTE_PRENSES","MUHAFIZ","HEKIM","BAS_CASUS","GOLGE_LIDER","ZEHIRBAZ","TAHT_TALIPLISI"]
}'::jsonb;
