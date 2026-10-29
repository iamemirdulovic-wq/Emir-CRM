-- Leads from property-investment.ae.
--
-- Deliberately NOT a second leads table. This CRM already has one: "contacts"
-- is the person and "opportunities" is the inquiry, and every rule that keeps a
-- lead from being lost or duplicated — identity resolution, sticky ownership,
-- the re-inquiry window, the SLA — hangs off those two. A parallel "leads"
-- table would mean a lead answered in one place still looked untouched in the
-- other, which is the single thing this system exists to prevent.
--
-- So a website lead becomes an ordinary contact and opportunity, and this table
-- holds only what the site knows that the CRM has nowhere else to put: the
-- matchmaker answers, the projects the buyer browsed before enquiring, the
-- site's own score and summary, and the whole event as received.
--
-- "payload" is the "website context" the agent sees on the lead. It is kept
-- whole rather than shredded into columns, because the site will add fields
-- faster than this schema can follow and a field nobody parsed is still worth
-- showing to the person about to make the call.

CREATE TABLE website_leads (
  id              varchar(36)     NOT NULL PRIMARY KEY,
  -- Which site. One row per site per lead, so a second brand later needs no
  -- migration.
  site            VARCHAR(64)  NOT NULL,
  -- Their primary key. Everything upserts on this.
  external_id     VARCHAR(128) NOT NULL,
  -- Their human-facing reference, the one a client quotes on the phone.
  public_ref      VARCHAR(64)  NULL,

  -- Where it landed in this CRM.
  contact_id      varchar(36)     NOT NULL,
  opportunity_id  varchar(36)     NULL,

  /*
   * The site's own view of the lead. Kept apart from the CRM's stage on
   * purpose: the pipeline stage is what the agent has actually done, and
   * letting a website status overwrite it would undo an agent's work every
   * time the site re-sent an event.
   */
  site_status     VARCHAR(48)  NULL,
  temperature     VARCHAR(24)  NULL,
  request_type    VARCHAR(48)  NULL,
  cta_location    VARCHAR(120) NULL,

  -- The project they enquired about, as the site names it. "project_id" on the
  -- opportunity is set too when the slug matches one in our library.
  site_project_id    VARCHAR(64)  NULL,
  site_project_slug  VARCHAR(160) NULL,
  site_project_name  VARCHAR(200) NULL,

  -- The site's advisor, who is not a CRM user. Recorded, never used to assign.
  advisor_id      VARCHAR(64)  NULL,
  advisor_name    VARCHAR(160) NULL,

  -- What the site worked out about them before we ever spoke.
  ai_summary      TEXT         NULL,
  score_reasons   jsonb         NULL,
  matchmaker      jsonb         NULL,
  viewed_projects jsonb         NULL,

  -- The whole event, exactly as it arrived.
  payload         jsonb         NOT NULL,

  -- Their clock, kept as data. The CRM timestamps the lead itself: a site with
  -- a wrong timezone must not be able to backdate a lead and quietly skew
  -- speed-to-lead.
  site_created_at timestamptz(3)  NULL,
  sent_at         timestamptz(3)  NULL,

  first_seen_at   timestamptz(3)  NOT NULL DEFAULT now(),
  last_event_at   timestamptz(3)  NOT NULL DEFAULT now(),
  event_count     bigint NOT NULL DEFAULT 1,

  CONSTRAINT uq_website_lead UNIQUE (site, external_id),
  CONSTRAINT fk_website_lead_contact FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE CASCADE,
  CONSTRAINT fk_website_lead_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities (id) ON DELETE SET NULL
);


-- Indexes (MySQL declares these inside CREATE TABLE).
CREATE INDEX idx_website_lead_contact ON website_leads (contact_id);
CREATE INDEX idx_website_lead_opportunity ON website_leads (opportunity_id);
CREATE INDEX idx_website_lead_ref ON website_leads (public_ref);

-- MySQL refreshes updated_at by itself; Postgres needs to be asked.
CREATE TRIGGER website_leads_set_updated_at BEFORE UPDATE ON website_leads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
