-- The sales offer as `design/web/sales-offers.html` draws it.
--
-- The `offers` table from migration 0011 was built for the big offer builder
-- in the original brief: a multi-section presentation page with a gallery, a
-- payment timeline and a developer sheet behind it. The new design is a much
-- smaller thing and a better one — "a one-page price sheet for one unit",
-- shared as a link the agent sends themselves.
--
-- Four columns is the whole difference. The rest of the table already holds
-- what the sheet needs: `hold_until` is the valid-until date, `description`
-- is the note for the client, and `slug` is the public address.
--
-- Additive only, as every migration here is: the offer builder's columns are
-- untouched and still work.

ALTER TABLE offers
  -- "2BR · 1204" — written by the agent, not chosen from the unit table.
  -- The design asks for a free-text label because an offer often goes out
  -- before the developer's unit list has been imported, and an agent who has
  -- the unit on a WhatsApp message from the developer should not be blocked.
  ADD COLUMN unit_label VARCHAR(120) NULL AFTER project_id,

  -- Whole AED, as an integer. Never a float: 2050000.1 is not a price anybody
  -- meant to type, and a rounding error in a number a client is quoted is the
  -- kind of mistake that is argued about later.
  ADD COLUMN price_aed BIGINT UNSIGNED NULL AFTER unit_label,

  -- "60 / 40", "40 / 60 post-handover". Free text for the same reason as the
  -- unit: it is whatever the developer is offering this week.
  ADD COLUMN payment_plan VARCHAR(80) NULL AFTER price_aed,

  -- The client said yes. A timestamp rather than a new status value, because
  -- changing an ENUM means ALTER ... MODIFY, which the migration guard
  -- refuses and is right to: it rewrites the column on a live table. It also
  -- matches how this table already works — "opened" and "reading now" are
  -- read from `offer_views`, never stored.
  ADD COLUMN accepted_at DATETIME(3) NULL AFTER sent_at;

-- Finding this month's accepted offers is the one query the new screen runs
-- that the existing indexes do not already cover.
CREATE INDEX idx_offer_accepted ON offers (accepted_at);
