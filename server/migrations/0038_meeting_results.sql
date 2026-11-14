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

-- REWRITTEN 14 Nov, after this migration took the live calendar down.
--
-- It used to add all ten columns in ONE `ALTER TABLE`. On the production
-- database some of them already existed and some did not, so the statement
-- failed on the first duplicate and -- being a single statement -- added
-- none of the rest. A migration is only recorded in `schema_migrations`
-- after it succeeds, so it was retried on every boot, failed identically
-- every time, and blocked every migration after it. The calendar answered
-- "Internal server error" for every person on every device for days with
-- `Unknown column 'm.booked_project'`, and no amount of redeploying could
-- ever have fixed it.
--
-- Each column is now added separately and only when it is really missing.
-- Editing this file rather than adding a new one is deliberate: migrations
-- are keyed by FILENAME, so a database where the old version completed has
-- this recorded and skips it untouched, while a database where it failed has
-- no record and runs this corrected version. A new file could not have
-- helped -- the broken one would still have thrown first and blocked it.
--
-- `ADD COLUMN IF NOT EXISTS` would be one line, but MariaDB has it and MySQL
-- 8 does not, and production is MariaDB while the tests are MySQL 8. That
-- gap has now caused three separate faults, so this uses information_schema
-- and a prepared statement, which both understand.
--
-- The `AFTER <column>` placements are gone on purpose: column order changes
-- nothing, and anchoring to a neighbour is what makes a migration fail on a
-- database that is missing that neighbour. Additive only.

SET @t := 'meetings';


-- Who asked: "Cancelled" (client / me / developer) and "Moved it".
SET @c := 'result_by';
SET @sql := (SELECT IF(COUNT(*) = 0,
  CONCAT('ALTER TABLE `', @t, '` ADD COLUMN `', @c, '` ENUM(''client'',''me'',''developer'') NULL'),
  'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @t AND COLUMN_NAME = @c);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Which project they booked in -- not always the lead's own project.
SET @c := 'booked_project';
SET @sql := (SELECT IF(COUNT(*) = 0,
  CONCAT('ALTER TABLE `', @t, '` ADD COLUMN `', @c, '` VARCHAR(160) NULL'),
  'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @t AND COLUMN_NAME = @c);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- "2BR - 1204". Free text: whatever the developer's list calls it.
SET @c := 'booked_unit';
SET @sql := (SELECT IF(COUNT(*) = 0,
  CONCAT('ALTER TABLE `', @t, '` ADD COLUMN `', @c, '` VARCHAR(80) NULL'),
  'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @t AND COLUMN_NAME = @c);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Money is a whole number of AED, never a float.
SET @c := 'booked_price_aed';
SET @sql := (SELECT IF(COUNT(*) = 0,
  CONCAT('ALTER TABLE `', @t, '` ADD COLUMN `', @c, '` BIGINT UNSIGNED NULL'),
  'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @t AND COLUMN_NAME = @c);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- The amount handed over in the room, which is not the price.
SET @c := 'booked_paid_aed';
SET @sql := (SELECT IF(COUNT(*) = 0,
  CONCAT('ALTER TABLE `', @t, '` ADD COLUMN `', @c, '` BIGINT UNSIGNED NULL'),
  'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @t AND COLUMN_NAME = @c);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- The booking form or receipt; the bytes live under UPLOAD_DIR.
SET @c := 'receipt_name';
SET @sql := (SELECT IF(COUNT(*) = 0,
  CONCAT('ALTER TABLE `', @t, '` ADD COLUMN `', @c, '` VARCHAR(255) NULL'),
  'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @t AND COLUMN_NAME = @c);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @c := 'receipt_type';
SET @sql := (SELECT IF(COUNT(*) = 0,
  CONCAT('ALTER TABLE `', @t, '` ADD COLUMN `', @c, '` VARCHAR(100) NULL'),
  'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @t AND COLUMN_NAME = @c);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @c := 'receipt_bytes';
SET @sql := (SELECT IF(COUNT(*) = 0,
  CONCAT('ALTER TABLE `', @t, '` ADD COLUMN `', @c, '` INT UNSIGNED NULL'),
  'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @t AND COLUMN_NAME = @c);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @c := 'receipt_path';
SET @sql := (SELECT IF(COUNT(*) = 0,
  CONCAT('ALTER TABLE `', @t, '` ADD COLUMN `', @c, '` VARCHAR(512) NULL'),
  'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @t AND COLUMN_NAME = @c);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @c := 'receipt_at';
SET @sql := (SELECT IF(COUNT(*) = 0,
  CONCAT('ALTER TABLE `', @t, '` ADD COLUMN `', @c, '` DATETIME(3) NULL'),
  'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @t AND COLUMN_NAME = @c);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
