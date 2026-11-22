-- Parties, finishes, groups, rates, firm details and the signature now live in the config file (mph-config.json).
DROP TABLE IF EXISTS rates;
DROP TABLE IF EXISTS finish_groups;
DROP TABLE IF EXISTS finishes;
DROP TABLE IF EXISTS parties;
DELETE FROM settings WHERE key IN ('firm', 'signature_png');
