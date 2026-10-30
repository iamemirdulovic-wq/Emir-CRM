-- Deleting a lead must stop destroying one.
--
-- Until now "delete" meant DELETE FROM contacts, and every foreign key into it
-- cascades: the opportunities, the activities, the whole WhatsApp thread, the
-- notes an agent wrote after a viewing. One owner clicking Delete on a hundred
-- selected rows took all of it, with nothing to restore from but last night's
-- dump.
--
-- From here a delete is a timestamp. The rows stay, the history stays, and a
-- client who comes back comes back with everything that was known about them.
--
-- Additive only: two nullable columns and two indexes. Nothing existing moves,
-- and every existing row is left as NULL, which means "not deleted" — so the
-- CRM behaves exactly as it did the moment this lands.

ALTER TABLE contacts
  ADD COLUMN deleted_at DATETIME(3) NULL AFTER merged_into_id,
  ADD COLUMN deleted_by_user_id CHAR(36) NULL AFTER deleted_at;

-- Every list query filters on this, and most of them also order by created_at
-- or filter by owner, so it leads the index rather than sitting alone in one.
ALTER TABLE contacts
  ADD KEY idx_contacts_live (deleted_at, created_at),
  ADD KEY idx_contacts_live_owner (deleted_at, owner_user_id);

ALTER TABLE opportunities
  ADD COLUMN deleted_at DATETIME(3) NULL AFTER closed_at,
  ADD COLUMN deleted_by_user_id CHAR(36) NULL AFTER deleted_at;

ALTER TABLE opportunities
  ADD KEY idx_opp_live (deleted_at, status, created_at),
  ADD KEY idx_opp_live_owner (deleted_at, owner_user_id, status);
