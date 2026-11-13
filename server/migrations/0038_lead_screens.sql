-- What the lead screens need and the schema does not have yet.
--
-- Additive only, like every migration here: new nullable columns, nothing
-- renamed, nothing modified, nothing dropped. See
-- `src/db/migrations.safety.test.ts` for the rule and why it exists.
--
-- ---------------------------------------------------------------------------
-- 1. The reason a lead was lost, in the words the agent chose
-- ---------------------------------------------------------------------------
--
-- `opportunities.lost_reason` is an ENUM of five values written in January:
-- not_interested, budget_mismatch, bought_elsewhere, unresponsive, invalid.
-- The lead page and the dialler both offer a different six, and MySQL runs
-- here with STRICT_TRANS_TABLES, so writing one of theirs into that column
-- does not round down to NULL -- it raises error 1265 and the whole Lost
-- transaction rolls back. Marking a lead Lost for anything but "bought
-- somewhere else" has therefore been failing outright, in the live CRM, for
-- as long as the button has existed.
--
-- Widening the ENUM would be `ALTER TABLE ... MODIFY`, which the safety test
-- refuses on principle (a MODIFY can truncate real values). So the full
-- reason gets a column of its own, beside the old one, exactly as `stage_v2`
-- sits beside `stage_key`:
--
--   * `lost_reason_v2` holds what the agent actually picked.
--   * `lost_reason` keeps being written with the nearest of its own five
--     values, so the lost-reasons report and Contact 360 carry on working and
--     nothing that reads the old column has to change.
ALTER TABLE opportunities
  ADD COLUMN lost_reason_v2 VARCHAR(48) NULL;

ALTER TABLE opportunities
  ADD KEY idx_opp_lost_reason_v2 (lost_reason_v2, closed_at);

-- ---------------------------------------------------------------------------
-- 2. The money on a Won deal
-- ---------------------------------------------------------------------------
--
-- `design/web/lead.html`'s Won dialog asks four things and the build asked
-- none of them: the price, how much was paid now, what was signed, and a
-- booking form or receipt -- "Without it the deal is not counted."
--
-- The price already has a home (`deal_value_aed`). These are the rest. AED,
-- stored as a whole number of dirhams like every other money column on this
-- table, never a float.
ALTER TABLE opportunities
  ADD COLUMN won_paid_aed BIGINT UNSIGNED NULL,
  ADD COLUMN won_signed ENUM('booking_form','reservation_agreement','spa') NULL,
  ADD COLUMN won_unit VARCHAR(80) NULL;

-- ---------------------------------------------------------------------------
-- 3. Which folder a file is in, and who has looked at it
-- ---------------------------------------------------------------------------
--
-- The lead page's Files tab has four folders -- All, Passport & ID, Booking
-- forms, WhatsApp screenshots -- and says two things in writing about the
-- first of them: "only you and owners see it" and "Every view is logged".
-- Nothing classified a file and nothing counted a view, so the tab could only
-- ever explain itself instead of listing anything.
--
-- `other` is the default so every file already uploaded stays valid and
-- lands in All, which is where it has always been.
ALTER TABLE note_files
  ADD COLUMN folder ENUM('photo','id','booking','whatsapp','receipt','other')
             NOT NULL DEFAULT 'other',
  ADD COLUMN view_count INT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN last_viewed_at DATETIME(3) NULL;

ALTER TABLE note_files
  ADD KEY idx_note_files_folder (contact_id, folder, created_at);
