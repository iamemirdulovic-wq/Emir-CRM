-- Sales offers: a lead plus a project turned into one private page the client
-- opens on their phone, a formal developer offer sheet, and a PDF.
--
-- Two decisions worth stating, because both are load-bearing:
--
-- 1. `offer_units` stores the unit's figures rather than pointing at `units`.
--    An offer is a quotation: it must keep showing the price the client was
--    actually shown, even after the developer sends a new price list. The
--    `unit_id` and `price_version_id` columns stay so a manager can see which
--    version it came from and which open offers a price change has stranded.
--
-- 2. The card's "Opened / Reading now" state is NOT a column. It is derived
--    from `offer_views`, so it cannot drift out of step with reality the way a
--    counter updated by a webhook eventually does.
--
-- `offer_terms` and `offer_incentives` from the specification are deliberately
-- not here. They belong to the developer sheet, which is built in a later part,
-- and a table guessed at now would be a table rewritten later.

-- --------------------------------------------------------------------------
-- Folders — the Drive-style library
-- --------------------------------------------------------------------------

CREATE TABLE offer_folders (
  id         CHAR(36)     NOT NULL PRIMARY KEY,
  name       VARCHAR(160) NOT NULL,
  -- One level of nesting only, as the specification asks. Enforced in the
  -- service: a folder whose parent already has a parent is rejected.
  parent_id  CHAR(36)     NULL,
  -- The Templates folder: everyone reads it, only owner/admin/manager writes.
  is_shared  TINYINT(1)   NOT NULL DEFAULT 0,
  created_by CHAR(36)     NULL,
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_offer_folder_parent (parent_id, name),
  CONSTRAINT fk_offer_folder_parent FOREIGN KEY (parent_id) REFERENCES offer_folders (id) ON DELETE CASCADE,
  CONSTRAINT fk_offer_folder_user FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------------------------
-- offers
-- --------------------------------------------------------------------------

CREATE TABLE offers (
  id              CHAR(36)     NOT NULL PRIMARY KEY,
  -- The public address: /offer/{slug}. It carries a client's name and a price
  -- list and has no login in front of it, so the random part is long enough
  -- that guessing one is not worth anybody's afternoon.
  slug            VARCHAR(120) NOT NULL,
  title           VARCHAR(200) NOT NULL,
  folder_id       CHAR(36)     NULL,

  -- Who it is for. All nullable: an offer can be started from a project card
  -- before the agent has picked the lead.
  contact_id      CHAR(36)     NULL,
  opportunity_id  CHAR(36)     NULL,
  project_id      CHAR(36)     NULL,

  -- Whose offer it is. This is the column every permission check reads.
  agent_user_id   CHAR(36)     NOT NULL,
  created_by      CHAR(36)     NULL,

  language        ENUM('en','ar','ru','hi') NOT NULL DEFAULT 'en',
  -- What the client is sent: the presentation, the developer sheet, or both.
  doc_types       ENUM('both','presentation','developer') NOT NULL DEFAULT 'both',
  who_appears     ENUM('both','agent','ceo','company') NOT NULL DEFAULT 'both',
  cover_style     TINYINT UNSIGNED NOT NULL DEFAULT 0,

  -- Which sections are on, and in what order. Written by the builder.
  sections        JSON         NULL,
  greeting        TEXT         NULL,
  description     TEXT         NULL,
  whatsapp_message TEXT        NULL,
  video_url       VARCHAR(1024) NULL,
  project_url     VARCHAR(1024) NULL,

  -- draft → sent → (revoked). "Opened" and "Reading now" are read from
  -- offer_views, never stored.
  status          ENUM('draft','sent','revoked') NOT NULL DEFAULT 'draft',
  sent_at         DATETIME(3)  NULL,
  -- The price-hold countdown on the client page.
  hold_until      DATETIME(3)  NULL,
  -- After this the link stops working, whatever else is true.
  expires_at      DATETIME(3)  NULL,

  notify_on_open  TINYINT(1)   NOT NULL DEFAULT 1,
  -- Ask for the client's phone before the page opens, so a forwarded link
  -- does not hand the whole quotation to a stranger.
  require_phone   TINYINT(1)   NOT NULL DEFAULT 0,
  allow_reactions TINYINT(1)   NOT NULL DEFAULT 1,

  starred         TINYINT(1)   NOT NULL DEFAULT 0,
  -- Trash. Purged after 30 days by the housekeeping job.
  deleted_at      DATETIME(3)  NULL,
  created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  UNIQUE KEY uq_offer_slug (slug),
  KEY idx_offer_owner (agent_user_id, deleted_at, updated_at),
  KEY idx_offer_folder (folder_id, deleted_at),
  KEY idx_offer_contact (contact_id),
  KEY idx_offer_trash (deleted_at),
  CONSTRAINT fk_offer_folder FOREIGN KEY (folder_id) REFERENCES offer_folders (id) ON DELETE SET NULL,
  CONSTRAINT fk_offer_contact FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE SET NULL,
  CONSTRAINT fk_offer_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities (id) ON DELETE SET NULL,
  CONSTRAINT fk_offer_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE SET NULL,
  CONSTRAINT fk_offer_agent FOREIGN KEY (agent_user_id) REFERENCES users (id),
  CONSTRAINT fk_offer_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------------------------
-- The units held for this client — a snapshot, on purpose
-- --------------------------------------------------------------------------

CREATE TABLE offer_units (
  id                 CHAR(36)     NOT NULL PRIMARY KEY,
  offer_id           CHAR(36)     NOT NULL,
  -- Where it came from. Kept so a price change can flag the open offers that
  -- quoted the old figure; the offer still shows the snapshot below.
  unit_id            CHAR(36)     NULL,
  price_version_id   CHAR(36)     NULL,

  unit_no            VARCHAR(64)  NOT NULL,
  unit_type          VARCHAR(64)  NULL,
  bedrooms           TINYINT UNSIGNED NULL,
  floor              VARCHAR(24)  NULL,
  internal_area_sqft DECIMAL(10,2) NULL,
  balcony_sqft       DECIMAL(10,2) NULL,
  view_text          VARCHAR(160) NULL,
  parking            TINYINT UNSIGNED NULL,
  price_aed          BIGINT UNSIGNED NULL,
  price_per_sqft_aed INT UNSIGNED NULL,
  status             ENUM('available','on_hold','reserved','sold') NOT NULL DEFAULT 'available',
  sort_order         SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE KEY uq_offer_unit (offer_id, unit_no),
  KEY idx_offer_unit_source (unit_id),
  CONSTRAINT fk_offerunit_offer FOREIGN KEY (offer_id) REFERENCES offers (id) ON DELETE CASCADE,
  CONSTRAINT fk_offerunit_unit FOREIGN KEY (unit_id) REFERENCES units (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------------------------
-- Tracking
-- --------------------------------------------------------------------------

-- One row per time the link is opened. `visitor` is a cookie set on the client
-- page: a second visitor on the same link is how a forward is spotted.
CREATE TABLE offer_views (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  offer_id      CHAR(36)     NOT NULL,
  visitor_token CHAR(32)     NULL,
  opened_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  -- Refreshed by the page while it is open, which is what "Reading now" reads.
  last_seen_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  duration_secs INT UNSIGNED NOT NULL DEFAULT 0,
  device        VARCHAR(32)  NULL,
  city          VARCHAR(120) NULL,
  country       VARCHAR(2)   NULL,
  -- Seconds spent per section, so the agent knows what the client read.
  sections      JSON         NULL,
  KEY idx_offer_view (offer_id, opened_at),
  KEY idx_offer_view_live (offer_id, last_seen_at),
  KEY idx_offer_view_visitor (offer_id, visitor_token),
  CONSTRAINT fk_offerview_offer FOREIGN KEY (offer_id) REFERENCES offers (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- What the client did: hearted a unit, asked something, downloaded the
-- brochure, or opened it on a device that had not seen the link before.
CREATE TABLE offer_events (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  offer_id      CHAR(36)     NOT NULL,
  view_id       CHAR(36)     NULL,
  kind          ENUM('heart','unheart','question','download','forward','phone_gate') NOT NULL,
  offer_unit_id CHAR(36)     NULL,
  body          TEXT         NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_offer_event (offer_id, created_at),
  CONSTRAINT fk_offerevent_offer FOREIGN KEY (offer_id) REFERENCES offers (id) ON DELETE CASCADE,
  CONSTRAINT fk_offerevent_view FOREIGN KEY (view_id) REFERENCES offer_views (id) ON DELETE SET NULL,
  CONSTRAINT fk_offerevent_unit FOREIGN KEY (offer_unit_id) REFERENCES offer_units (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
