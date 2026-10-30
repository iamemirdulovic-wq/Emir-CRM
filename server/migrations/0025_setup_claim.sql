-- One owner from first-run setup, enforced by the database.
--
-- CI caught the race this fixes: two people submitting the setup form at the
-- same moment both got an owner account. The route already took a named lock
-- (`GET_LOCK('emir_crm_setup')`), and that lock was *released inside the
-- transaction*, before the commit. So the second connection took the lock in
-- the gap, counted the users table — which still looked empty, because the
-- first insert was not committed yet — and inserted a second owner. Both
-- committed. Two owners, no error, no sign anything had gone wrong.
--
-- An advisory lock could be made to cover the commit, but it would still be a
-- rule living in application code, and the thing it protects is the one account
-- in the system nobody authorised. So the guarantee moves into the schema: a
-- single row, with a fixed primary key, written in the same transaction as the
-- account. The second transaction blocks on that key until the first commits,
-- then fails with a duplicate — which the route turns into "this CRM has
-- already been set up".
--
-- `id` is `1` and can never be anything else. That is the whole point: there is
-- exactly one first owner, so there is exactly one row.
--
-- It is also a useful record in itself. When the CRM was claimed, by which
-- account, and from which address is worth keeping — a deployment that was
-- claimed from an address nobody recognises is a deployment to rebuild.
--
-- Deliberately **no foreign key to `users`**. A cascade here would reopen
-- first-run setup the day somebody deleted the owner account, which is the one
-- thing this table exists to prevent. The row outlives the account it names.

CREATE TABLE IF NOT EXISTS setup_claims (
  -- Always 1. The CHECK is what makes a second row impossible rather than
  -- merely unlikely.
  id         TINYINT UNSIGNED NOT NULL,
  user_id    CHAR(36)     NOT NULL,
  email      VARCHAR(255) NOT NULL,
  ip         VARCHAR(45)  NULL,
  user_agent VARCHAR(255) NULL,
  claimed_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT ck_setup_claim_singleton CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
