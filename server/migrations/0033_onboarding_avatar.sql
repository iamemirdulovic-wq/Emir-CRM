-- Which set of pictures the welcome shows an agent.
--
-- Emir, Nov 4 2026, supplied two matching sets of illustrations, one of a man
-- and one of a woman, and asked that each person see the one that looks like
-- them.
--
-- Stored as a choice of picture, not as a field about the person. The
-- difference matters: a gender column on a staff record is personal data
-- under the UAE PDPL, would want a reason to exist, a retention rule and an
-- answer to "who can see it" — and nothing in this CRM needs one. What the
-- welcome needs is which of two folders to read a JPEG from, and that is all
-- this column is. It is nullable because somebody can skip the question, and
-- a null simply means the welcome picks one.
--
-- Not called `character`: that is a reserved word in MySQL and would need
-- back-ticking at every use.

ALTER TABLE user_onboarding
  ADD COLUMN avatar_set VARCHAR(16) NULL AFTER preferred_name;
