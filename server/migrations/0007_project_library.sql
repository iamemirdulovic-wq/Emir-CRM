-- The off-plan project library.
--
-- `projects` already exists and is read by Workflow C to answer PRICING,
-- LOCATION and BROCHURE, so it is *extended* rather than replaced: the live
-- columns keep their meaning and the new ones start empty. Nothing that works
-- today stops working when this applies.
--
-- The shape the spec asks for is a library, not a table: a project has many
-- units, each unit belongs to a price version, and a project has plans, media,
-- floor plans, amenities, documents, a location, a commission and an import
-- history. That is why one flat row cannot carry it.

-- --------------------------------------------------------------------------
-- Developers — who we sell for
-- --------------------------------------------------------------------------

CREATE TABLE developers (
  id              CHAR(36)     NOT NULL PRIMARY KEY,
  slug            VARCHAR(120) NOT NULL,
  legal_name      VARCHAR(200) NOT NULL,
  short_name      VARCHAR(120) NOT NULL,
  orn             VARCHAR(64)  NULL,
  trn             VARCHAR(64)  NULL,
  head_office     VARCHAR(255) NULL,
  escrow_bank     VARCHAR(160) NULL,
  logo_url        VARCHAR(1024) NULL,
  website         VARCHAR(255) NULL,
  -- Our terms with them. Owner/admin/manager only, never in a client offer.
  commission_pct  DECIMAL(5,2) NULL,
  payment_terms   VARCHAR(255) NULL,
  agreement_date  DATE         NULL,
  avg_days_to_pay SMALLINT UNSIGNED NULL,
  track_record    TEXT         NULL,
  notes           TEXT         NULL,
  created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_developer_slug (slug),
  KEY idx_developer_name (short_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Their own sales people. This is where a developer's broker-relations and
-- bookings numbers live, so an agent can ring them from the project page.
CREATE TABLE developer_contacts (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  developer_id  CHAR(36)     NOT NULL,
  name          VARCHAR(160) NOT NULL,
  role          VARCHAR(120) NULL,
  phone_e164    VARCHAR(24)  NULL,
  whatsapp_e164 VARCHAR(24)  NULL,
  email         VARCHAR(255) NULL,
  is_primary    TINYINT(1)   NOT NULL DEFAULT 0,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_devcontact (developer_id, is_primary),
  CONSTRAINT fk_devcontact_dev FOREIGN KEY (developer_id) REFERENCES developers (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------------------------
-- projects — new columns only
-- --------------------------------------------------------------------------

ALTER TABLE projects
  -- The text column `developer` stays: it is what the live WhatsApp replies and
  -- every existing lead already reference. This links to the record when there
  -- is one, and the two are kept in step by the service layer.
  ADD COLUMN developer_id CHAR(36) NULL AFTER developer,
  ADD COLUMN community VARCHAR(160) NULL AFTER area,
  ADD COLUMN property_type ENUM('apartment','townhouse','villa','penthouse','plot','office','mixed') NULL AFTER community,
  ADD COLUMN sale_status ENUM('selling_now','coming_soon','sold_out') NOT NULL DEFAULT 'selling_now' AFTER property_type,
  ADD COLUMN rera_no VARCHAR(64) NULL,
  ADD COLUMN escrow_account VARCHAR(160) NULL,
  ADD COLUMN ownership ENUM('freehold','leasehold') NULL,
  ADD COLUMN service_charge_sqft DECIMAL(8,2) NULL,
  ADD COLUMN golden_visa_threshold_aed BIGINT UNSIGNED NULL,
  ADD COLUMN construction_pct TINYINT UNSIGNED NULL,
  ADD COLUMN buyer_profile TEXT NULL,
  ADD COLUMN marketing_copy TEXT NULL,
  ADD COLUMN cover_style VARCHAR(32) NULL,
  -- Private today. The public option is built now and stays off until the
  -- website exists, exactly as the spec asks.
  ADD COLUMN visibility ENUM('private','team','public') NOT NULL DEFAULT 'private',
  ADD COLUMN visible_team_id CHAR(36) NULL,
  ADD COLUMN starred TINYINT(1) NOT NULL DEFAULT 0,
  -- Archive is the recommended alternative to deleting; an archived project
  -- keeps every lead and offer that points at it.
  ADD COLUMN archived_at DATETIME(3) NULL,
  ADD COLUMN archived_by_user_id CHAR(36) NULL;

ALTER TABLE projects
  ADD KEY idx_project_developer (developer_id),
  ADD KEY idx_project_library (archived_at, sale_status, emirate),
  ADD KEY idx_project_starred (starred, archived_at);

ALTER TABLE projects
  ADD CONSTRAINT fk_project_developer FOREIGN KEY (developer_id) REFERENCES developers (id) ON DELETE SET NULL;

-- --------------------------------------------------------------------------
-- Units and the price versions they belong to
-- --------------------------------------------------------------------------

-- Every price-list import is a version, so an offer can record which figures
-- it quoted and a later import can show what changed.
CREATE TABLE unit_price_versions (
  id           CHAR(36)     NOT NULL PRIMARY KEY,
  project_id   CHAR(36)     NOT NULL,
  label        VARCHAR(160) NOT NULL,
  source_file  VARCHAR(255) NULL,
  note         VARCHAR(500) NULL,
  imported_by_user_id CHAR(36) NULL,
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_priceversion (project_id, created_at),
  CONSTRAINT fk_priceversion_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The inventory. This table is the only price source the system may quote.
CREATE TABLE units (
  id                CHAR(36)     NOT NULL PRIMARY KEY,
  project_id        CHAR(36)     NOT NULL,
  price_version_id  CHAR(36)     NULL,
  unit_no           VARCHAR(64)  NOT NULL,
  unit_type         VARCHAR(64)  NULL,
  bedrooms          TINYINT UNSIGNED NULL,
  floor             VARCHAR(24)  NULL,
  internal_area_sqft DECIMAL(10,2) NULL,
  balcony_sqft      DECIMAL(10,2) NULL,
  view_text         VARCHAR(160) NULL,
  parking           TINYINT UNSIGNED NULL,
  price_aed         BIGINT UNSIGNED NULL,
  -- Stored rather than derived: a developer's own sheet sometimes rounds it,
  -- and an offer has to reproduce the number the client was shown.
  price_per_sqft_aed INT UNSIGNED NULL,
  status            ENUM('available','on_hold','reserved','sold') NOT NULL DEFAULT 'available',
  created_at        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  -- One unit number per project. A re-import updates the row rather than
  -- adding a second unit 1204.
  UNIQUE KEY uq_unit (project_id, unit_no),
  KEY idx_unit_available (project_id, status, price_aed),
  CONSTRAINT fk_unit_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
  CONSTRAINT fk_unit_priceversion FOREIGN KEY (price_version_id) REFERENCES unit_price_versions (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------------------------
-- Payment plans
-- --------------------------------------------------------------------------

CREATE TABLE payment_plans (
  id          CHAR(36)     NOT NULL PRIMARY KEY,
  project_id  CHAR(36)     NOT NULL,
  name        VARCHAR(160) NOT NULL,
  is_default  TINYINT(1)   NOT NULL DEFAULT 0,
  note        VARCHAR(500) NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_plan_project (project_id, is_default),
  CONSTRAINT fk_plan_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE payment_plan_rows (
  id         CHAR(36)     NOT NULL PRIMARY KEY,
  plan_id    CHAR(36)     NOT NULL,
  seq        SMALLINT UNSIGNED NOT NULL,
  milestone  VARCHAR(200) NOT NULL,
  percent    DECIMAL(6,3) NOT NULL,
  due_note   VARCHAR(160) NULL,
  KEY idx_planrow (plan_id, seq),
  CONSTRAINT fk_planrow_plan FOREIGN KEY (plan_id) REFERENCES payment_plans (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------------------------
-- Media, floor plans, amenities, documents, location
-- --------------------------------------------------------------------------

CREATE TABLE project_media (
  id           CHAR(36)     NOT NULL PRIMARY KEY,
  project_id   CHAR(36)     NOT NULL,
  kind         ENUM('photo','video','tour_360') NOT NULL DEFAULT 'photo',
  storage_path VARCHAR(512) NULL,
  url          VARCHAR(1024) NULL,
  filename     VARCHAR(255) NULL,
  content_type VARCHAR(127) NULL,
  byte_size    INT UNSIGNED NULL,
  caption      VARCHAR(255) NULL,
  is_cover     TINYINT(1)   NOT NULL DEFAULT 0,
  sort_order   SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_media_project (project_id, kind, sort_order),
  CONSTRAINT fk_media_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE project_floorplans (
  id           CHAR(36)     NOT NULL PRIMARY KEY,
  project_id   CHAR(36)     NOT NULL,
  layout       VARCHAR(120) NOT NULL,
  storage_path VARCHAR(512) NOT NULL,
  filename     VARCHAR(255) NOT NULL,
  content_type VARCHAR(127) NOT NULL,
  byte_size    INT UNSIGNED NOT NULL,
  sort_order   SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_floorplan_project (project_id, sort_order),
  CONSTRAINT fk_floorplan_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE project_amenities (
  id         CHAR(36)     NOT NULL PRIMARY KEY,
  project_id CHAR(36)     NOT NULL,
  name       VARCHAR(120) NOT NULL,
  enabled    TINYINT(1)   NOT NULL DEFAULT 1,
  UNIQUE KEY uq_amenity (project_id, name),
  CONSTRAINT fk_amenity_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE project_documents (
  id           CHAR(36)     NOT NULL PRIMARY KEY,
  project_id   CHAR(36)     NOT NULL,
  -- `developer_offer` is special: when one is uploaded the offer builder
  -- attaches that file instead of generating its own sheet.
  kind         ENUM('developer_offer','brochure_en','brochure_ar','price_list','floor_plan_pack',
                    'master_plan','payment_plan_sheet','rera_certificate','commission_agreement',
                    'spa_template','other') NOT NULL DEFAULT 'other',
  filename     VARCHAR(255) NOT NULL,
  storage_path VARCHAR(512) NOT NULL,
  content_type VARCHAR(127) NOT NULL,
  byte_size    INT UNSIGNED NOT NULL,
  uploaded_by_user_id CHAR(36) NULL,
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_doc_project (project_id, kind),
  CONSTRAINT fk_doc_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE project_locations (
  project_id    CHAR(36)      NOT NULL PRIMARY KEY,
  lat           DECIMAL(10,7) NULL,
  lng           DECIMAL(10,7) NULL,
  address       VARCHAR(255)  NULL,
  sales_centre  VARCHAR(255)  NULL,
  -- [{ "to": "Airport", "minutes": 25 }, …] — editable per project.
  distances     JSON          NULL,
  CONSTRAINT fk_location_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------------------------
-- Commission (never shown to an agent or in a client offer) and imports
-- --------------------------------------------------------------------------

CREATE TABLE project_commissions (
  project_id            CHAR(36)     NOT NULL PRIMARY KEY,
  rate_pct              DECIMAL(5,2) NULL,
  payment_terms         VARCHAR(255) NULL,
  agreement_date        DATE         NULL,
  avg_days_to_pay       SMALLINT UNSIGNED NULL,
  default_agent_split_pct DECIMAL(5,2) NULL,
  note                  TEXT         NULL,
  updated_at            DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_commission_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- What the AI read out of a developer file, kept so a wrong extraction can be
-- traced back to the document it came from.
CREATE TABLE project_imports (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  project_id    CHAR(36)     NULL,
  source_kind   ENUM('file','link','manual') NOT NULL DEFAULT 'file',
  source_name   VARCHAR(255) NULL,
  storage_path  VARCHAR(512) NULL,
  extracted     JSON         NULL,
  confidence    JSON         NULL,
  status        ENUM('reading','ready','confirmed','failed') NOT NULL DEFAULT 'reading',
  error         VARCHAR(500) NULL,
  confirmed_by_user_id CHAR(36) NULL,
  created_by_user_id   CHAR(36) NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_projectimport (project_id, created_at),
  CONSTRAINT fk_projectimport_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
