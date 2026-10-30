-- Why a lead scored what it did, in words.
--
-- The score has always been a number out of a hundred with its components
-- recorded, but only the number reached a screen. "82" tells an agent to call
-- this one first; it does not tell them what to open with. "Budget AED 2.5M ·
-- ready now · replied on WhatsApp" does both.
--
-- Stored rather than rebuilt on read because the reason belongs to the moment
-- it was scored: a lead that was hot in March because they were ready to buy
-- did not become a different lead when the rules were tuned in June.

ALTER TABLE opportunities
  ADD COLUMN score_reason VARCHAR(255) NULL AFTER lead_score,
  ADD COLUMN score_band ENUM('hot', 'warm', 'cold') NULL AFTER score_reason;

-- The pipeline and the lists both want "show me the hot ones" without reading
-- every row to work out which those are.
ALTER TABLE opportunities
  ADD KEY idx_opp_band (deleted_at, score_band, status);
