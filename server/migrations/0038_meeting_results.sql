-- What a meeting actually produced.
--
-- `meetings` has carried `result` since 0036, and nothing else. The design
-- (`design/web/calendar.html`, the "How did it go?" panel) asks five different
-- questions behind the five answers, and four of them have nowhere to go:
--
--   * Showed up    -- how interested, and what is next. `interest` already
--                     exists; the next step becomes a second row in this same
--                     table, so it needs no column.
--   * Moved it     -- the new day and time, and who asked. The plan itself
--                     moves, so only "who asked" is new.
--   * Cancelled    -- who cancelled: the client, me, or the developer.
--   * Booked a unit-- the unit, the price, what was paid now, and the booking
--                     form or receipt. The owner checks that receipt before
--                     the deal counts, so a booking without one is refused.
--
-- `cancelled_by` from 0036 is ENUM('client','us') and is read by nothing. It
-- cannot answer the question the design asks, because the design's third
-- answer is "Developer", and widening an ENUM means ALTER ... MODIFY, which
-- the migration guard refuses and is right to. So one new column answers it
-- for both "who cancelled" and "who asked to move it", and the old column is
-- left exactly where it is.
--
-- Money is a whole number of AED, never a float: a price a client is quoted is
-- the kind of number that gets argued about later.
--
-- Additive only: nine nullable columns on one table. Nothing is dropped,
-- renamed or retyped, and a row written by the code running today is still a
-- valid row afterwards.

ALTER TABLE meetings
  -- Who asked: used by "Cancelled" (client / me / developer) and by "Moved it"
  -- (client / me). One column, because it is one question.
  ADD COLUMN result_by ENUM('client','me','developer') NULL AFTER result_at,

  -- Which project they booked in. Usually the lead's own project, but not
  -- always: a client walks into a sales centre for Valia and reserves in The
  -- Archive next door, and the lead's `project_name` is what they asked about
  -- first. Both are worth keeping.
  ADD COLUMN booked_project VARCHAR(160) NULL AFTER result_by,

  -- "2BR · 1204". Free text, because it is whatever the developer's list calls
  -- it this week, and the unit may not be in our own inventory yet.
  ADD COLUMN booked_unit VARCHAR(80) NULL AFTER booked_project,
  ADD COLUMN booked_price_aed BIGINT UNSIGNED NULL AFTER booked_unit,
  -- The booking amount handed over in the room, which is not the price.
  ADD COLUMN booked_paid_aed BIGINT UNSIGNED NULL AFTER booked_price_aed,

  -- The booking form or the receipt. The bytes live on disk under UPLOAD_DIR
  -- named after the meeting id, as every other upload in the CRM does; the
  -- name the agent's phone gave the file is kept only to show and download as.
  ADD COLUMN receipt_name VARCHAR(255) NULL AFTER booked_paid_aed,
  ADD COLUMN receipt_type VARCHAR(100) NULL AFTER receipt_name,
  ADD COLUMN receipt_bytes INT UNSIGNED NULL AFTER receipt_type,
  ADD COLUMN receipt_path VARCHAR(512) NULL AFTER receipt_bytes,
  ADD COLUMN receipt_at DATETIME(3) NULL AFTER receipt_path;
