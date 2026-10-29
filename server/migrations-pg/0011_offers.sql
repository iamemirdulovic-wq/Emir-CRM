-- Sales offers: a lead plus a project turned into one private page the client
-- opens on their phone, a formal developer offer sheet, and a PDF.
--
-- Two decisions worth stating, because both are load-bearing:
--
-- 1. "offer_units" stores the unit's figures rather than pointing at "units".
--    An offer is a quotation: it must keep showing the price the client was
--    actually shown, even developer sends a new price list. The
--    "unit_id" and "price_version_id" columns stay so a manager can see which
--    version it came from and which open offers a price change has stranded.
--
-- 2. The card's "Opened / Reading now" state is NOT a column. It is derived
--    from "offer_views", so it cannot drift out of step with reality the way a
--    counter updated by a webhook eventually does.
--
-- "offer_terms" and "offer_incentives" from the specification are deliberately
-- not here. They belong to the developer sheet, which is built in a later part,
-- and a table guessed at now would be a table rewritten later.

-- --------------------------------------------------------------------------
-- Folders — the Drive-style library
-- --------------------------------------------------------------------------

CREATE TABLE offer_folders (
  id         varchar(36)     NOT NULL PRIMARY KEY,
  name       VARCHAR(160) NOT NULL,
  -- One level of nesting only, as the specification asks. Enforced in the
  -- service: a folder whose parent already has a parent is rejected.
  parent_id  varchar(36)     NULL,
  -- The Templates folder: everyone reads it, only owner/admin/manager writes.
  is_shared  smallint   NOT NULL DEFAULT 0,
  created_by varchar(36)     NULL,
  created_at timestamptz(3)  NOT NULL DEFAULT now(),
  updated_at timestamptz(3)  NOT NULL DEFAULT now(),
  CONSTRAINT fk_offer_folder_parent FOREIGN KEY (parent_id) REFERENCES offer_folders (id) ON DELETE CASCADE,
  CONSTRAINT fk_offer_folder_user FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
);

-- --------------------------------------------------------------------------
-- offers
-- --------------------------------------------------------------------------

CREATE TABLE offers (
  id              varchar(36)     NOT NULL PRIMARY KEY,
  -- The public address: /offer/{slug}. It carries a client's name and a price
  -- list and has no login in front of it, so the random part is long enough
  -- that guessing one is not worth anybody's afternoon.
  slug            VARCHAR(120) NOT NULL,
  title           VARCHAR(200) NOT NULL,
  folder_id       varchar(36)     NULL,

  -- Who it is for. All nullable: an offer can be started from a project card
  -- before the agent has picked the lead.
  contact_id      varchar(36)     NULL,
  opportunity_id  varchar(36)     NULL,
  project_id      varchar(36)     NULL,

  -- Whose offer it is. This is the column every permission check reads.
  agent_user_id   varchar(36)     NOT NULL,
  created_by      varchar(36)     NULL,

  language text NOT NULL DEFAULT 'en' CHECK (language IN ('en','ar','ru','hi')),
  -- What the client is sent: the presentation, the developer sheet, or both.
  doc_types text NOT NULL DEFAULT 'both' CHECK (doc_types IN ('both','presentation','developer')),
  who_appears text NOT NULL DEFAULT 'both' CHECK (who_appears IN ('both','agent','ceo','company')),
  cover_style     smallint NOT NULL DEFAULT 0,

  -- Which sections are on, and in what order. Written by the builder.
  sections        jsonb         NULL,
  greeting        TEXT         NULL,
  description     TEXT         NULL,
  whatsapp_message TEXT        NULL,
  video_url       VARCHAR(1024) NULL,
  project_url     VARCHAR(1024) NULL,

  -- draft → sent → (revoked). "Opened" and "Reading now" are read from
  -- offer_views, never stored.
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','revoked')),
  sent_at         timestamptz(3)  NULL,
  -- The price-hold countdown on the client page.
  hold_until      timestamptz(3)  NULL,
  -- the link stops working, whatever else is true.
  expires_at      timestamptz(3)  NULL,

  notify_on_open  smallint   NOT NULL DEFAULT 1,
  -- Ask for the client's phone before the page opens, so a forwarded link
  -- does not hand the whole quotation to a stranger.
  require_phone   smallint   NOT NULL DEFAULT 0,
  allow_reactions smallint   NOT NULL DEFAULT 1,

  starred         smallint   NOT NULL DEFAULT 0,
  -- Trash. Purged days by the housekeeping job.
  deleted_at      timestamptz(3)  NULL,
  created_at      timestamptz(3)  NOT NULL DEFAULT now(),
  updated_at      timestamptz(3)  NOT NULL DEFAULT now(),

  CONSTRAINT uq_offer_slug UNIQUE (slug),
  CONSTRAINT fk_offer_folder FOREIGN KEY (folder_id) REFERENCES offer_folders (id) ON DELETE SET NULL,
  CONSTRAINT fk_offer_contact FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE SET NULL,
  CONSTRAINT fk_offer_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities (id) ON DELETE SET NULL,
  CONSTRAINT fk_offer_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE SET NULL,
  CONSTRAINT fk_offer_agent FOREIGN KEY (agent_user_id) REFERENCES users (id),
  CONSTRAINT fk_offer_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
);

-- --------------------------------------------------------------------------
-- The units held for this client — a snapshot, on purpose
-- --------------------------------------------------------------------------

CREATE TABLE offer_units (
  id                 varchar(36)     NOT NULL PRIMARY KEY,
  offer_id           varchar(36)     NOT NULL,
  -- Where it came from. Kept so a price change can flag the open offers that
  -- quoted the old figure; the offer still shows the snapshot below.
  unit_id            varchar(36)     NULL,
  price_version_id   varchar(36)     NULL,

  unit_no            VARCHAR(64)  NOT NULL,
  unit_type          VARCHAR(64)  NULL,
  bedrooms           smallint NULL,
  floor              VARCHAR(24)  NULL,
  internal_area_sqft numeric(10,2) NULL,
  balcony_sqft       numeric(10,2) NULL,
  view_text          VARCHAR(160) NULL,
  parking            smallint NULL,
  price_aed          bigint NULL,
  price_per_sqft_aed bigint NULL,
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available','on_hold','reserved','sold')),
  sort_order         integer NOT NULL DEFAULT 0,
  created_at         timestamptz(3)  NOT NULL DEFAULT now(),

  CONSTRAINT uq_offer_unit UNIQUE (offer_id, unit_no),
  CONSTRAINT fk_offerunit_offer FOREIGN KEY (offer_id) REFERENCES offers (id) ON DELETE CASCADE,
  CONSTRAINT fk_offerunit_unit FOREIGN KEY (unit_id) REFERENCES units (id) ON DELETE SET NULL
);

-- --------------------------------------------------------------------------
-- Tracking
-- --------------------------------------------------------------------------

-- One row per time the link is opened. "visitor" is a cookie set on the client
-- page: a second visitor on the same link is how a forward is spotted.
CREATE TABLE offer_views (
  id            varchar(36)     NOT NULL PRIMARY KEY,
  offer_id      varchar(36)     NOT NULL,
  visitor_token varchar(32)     NULL,
  opened_at     timestamptz(3)  NOT NULL DEFAULT now(),
  -- Refreshed by the page while it is open, which is what "Reading now" reads.
  last_seen_at  timestamptz(3)  NOT NULL DEFAULT now(),
  duration_secs bigint NOT NULL DEFAULT 0,
  device        VARCHAR(32)  NULL,
  city          VARCHAR(120) NULL,
  country       VARCHAR(2)   NULL,
  -- Seconds spent per section, so the agent knows what the client read.
  sections      jsonb         NULL,
  CONSTRAINT fk_offerview_offer FOREIGN KEY (offer_id) REFERENCES offers (id) ON DELETE CASCADE
);

-- What the client did: hearted a unit, asked something, downloaded the
-- brochure, or opened it on a device that had not seen the link before.
CREATE TABLE offer_events (
  id            varchar(36)     NOT NULL PRIMARY KEY,
  offer_id      varchar(36)     NOT NULL,
  view_id       varchar(36)     NULL,
  kind text NOT NULL CHECK (kind IN ('heart','unheart','question','download','forward','phone_gate')),
  offer_unit_id varchar(36)     NULL,
  body          TEXT         NULL,
  created_at    timestamptz(3)  NOT NULL DEFAULT now(),
  CONSTRAINT fk_offerevent_offer FOREIGN KEY (offer_id) REFERENCES offers (id) ON DELETE CASCADE,
  CONSTRAINT fk_offerevent_view FOREIGN KEY (view_id) REFERENCES offer_views (id) ON DELETE SET NULL,
  CONSTRAINT fk_offerevent_unit FOREIGN KEY (offer_unit_id) REFERENCES offer_units (id) ON DELETE SET NULL
);


-- Indexes (MySQL declares these inside CREATE TABLE).
CREATE INDEX idx_offer_folder_parent ON offer_folders (parent_id, name);
CREATE INDEX idx_offer_owner ON offers (agent_user_id, deleted_at, updated_at);
CREATE INDEX idx_offer_folder ON offers (folder_id, deleted_at);
CREATE INDEX idx_offer_contact ON offers (contact_id);
CREATE INDEX idx_offer_trash ON offers (deleted_at);
CREATE INDEX idx_offer_unit_source ON offer_units (unit_id);
CREATE INDEX idx_offer_view ON offer_views (offer_id, opened_at);
CREATE INDEX idx_offer_view_live ON offer_views (offer_id, last_seen_at);
CREATE INDEX idx_offer_view_visitor ON offer_views (offer_id, visitor_token);
CREATE INDEX idx_offer_event ON offer_events (offer_id, created_at);

-- MySQL refreshes updated_at by itself; Postgres needs to be asked.
CREATE TRIGGER offer_folders_set_updated_at BEFORE UPDATE ON offer_folders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER offers_set_updated_at BEFORE UPDATE ON offers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
