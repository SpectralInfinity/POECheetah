-- Which Path of Building release calculated a version's stats, and the stats
-- it had before a recalculation with a newer release (patch impact, design doc §3.10).
ALTER TABLE build_versions ADD COLUMN pob_version TEXT;
ALTER TABLE build_versions ADD COLUMN previous TEXT;
