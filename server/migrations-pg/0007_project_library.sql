-- The off-plan project library.
--
-- "projects" already exists and is read by Workflow C to answer PRICING,
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
  id              varchar(36)     NOT NULL PRIMARY KEY,
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
  commission_pct  numeric(5,2) NULL,
  payment_terms   VARCHAR(255) NULL,
  agreement_date  DATE         NULL,
  avg_days_to_pay integer NULL,
  track_record    TEXT         NULL,
  notes           TEXT         NULL,
  created_at      timestamptz(3)  NOT NULL DEFAULT now(),
  updated_at      timestamptz(3)  NOT NULL DEFAULT now(),
  CONSTRAINT uq_developer_slug UNIQUE (slug)
);

-- Their own sales people. This is where a developer's broker-relations and
-- bookings numbers live, so an agent can ring them from the project page.
CREATE TABLE developer_contacts (
  id            varchar(36)     NOT NULL PRIMARY KEY,
  developer_id  varchar(36)     NOT NULL,
  name          VARCHAR(160) NOT NULL,
  role          VARCHAR(120) NULL,
  phone_e164    VARCHAR(24)  NULL,
  whatsapp_e164 VARCHAR(24)  NULL,
  email         VARCHAR(255) NULL,
  is_primary    smallint   NOT NULL DEFAULT 0,
  created_at    timestamptz(3)  NOT NULL DEFAULT now(),
  CONSTRAINT fk_devcontact_dev FOREIGN KEY (developer_id) REFERENCES developers (id) ON DELETE CASCADE
);

-- --------------------------------------------------------------------------
-- projects — new columns only
-- --------------------------------------------------------------------------

  -- The text column "developer" stays: it is what the live WhatsApp replies and
  -- every existing lead already reference. This links to the record when there
  -- is one, and the two are kept in step by the service layer.
  -- Private today. The public option is built now and stays off until the
  -- website exists, exactly as the spec asks.
  -- Archive is the recommended alternative to deleting; an archived project
  -- keeps every lead and offer that points at it.
ALTER TABLE projects
  ADD COLUMN developer_id varchar(36) NULL,
  ADD COLUMN community VARCHAR(160) NULL,
  ADD COLUMN property_type text NULL CHECK (property_type IN ('apartment','townhouse','villa','penthouse','plot','office','mixed')),
  ADD COLUMN sale_status text NOT NULL DEFAULT 'selling_now' CHECK (sale_status IN ('selling_now','coming_soon','sold_out')),
  ADD COLUMN rera_no VARCHAR(64) NULL,
  ADD COLUMN escrow_account VARCHAR(160) NULL,
  ADD COLUMN ownership text NULL CHECK (ownership IN ('freehold','leasehold')),
  ADD COLUMN service_charge_sqft numeric(8,2) NULL,
  ADD COLUMN golden_visa_threshold_aed bigint NULL,
  ADD COLUMN construction_pct smallint NULL,
  ADD COLUMN buyer_profile TEXT NULL,
  ADD COLUMN marketing_copy TEXT NULL,
  ADD COLUMN cover_style VARCHAR(32) NULL,
  ADD COLUMN visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','team','public')),
  ADD COLUMN visible_team_id varchar(36) NULL,
  ADD COLUMN starred smallint NOT NULL DEFAULT 0,
  ADD COLUMN archived_at timestamptz(3) NULL,
  ADD COLUMN archived_by_user_id varchar(36) NULL;



ALTER TABLE projects
  ADD CONSTRAINT fk_project_developer FOREIGN KEY (developer_id) REFERENCES developers (id) ON DELETE SET NULL;

-- --------------------------------------------------------------------------
-- Units and the price versions they belong to
-- --------------------------------------------------------------------------

-- Every price-list import is a version, so an offer can record which figures
-- it quoted and a later import can show what changed.
CREATE TABLE unit_price_versions (
  id           varchar(36)     NOT NULL PRIMARY KEY,
  project_id   varchar(36)     NOT NULL,
  label        VARCHAR(160) NOT NULL,
  source_file  VARCHAR(255) NULL,
  note         VARCHAR(500) NULL,
  imported_by_user_id varchar(36) NULL,
  created_at   timestamptz(3)  NOT NULL DEFAULT now(),
  CONSTRAINT fk_priceversion_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);

-- The inventory. This table is the only price source the system may quote.
CREATE TABLE units (
  id                varchar(36)     NOT NULL PRIMARY KEY,
  project_id        varchar(36)     NOT NULL,
  price_version_id  varchar(36)     NULL,
  unit_no           VARCHAR(64)  NOT NULL,
  unit_type         VARCHAR(64)  NULL,
  bedrooms          smallint NULL,
  floor             VARCHAR(24)  NULL,
  internal_area_sqft numeric(10,2) NULL,
  balcony_sqft      numeric(10,2) NULL,
  view_text         VARCHAR(160) NULL,
  parking           smallint NULL,
  price_aed         bigint NULL,
  -- Stored rather than derived: a developer's own sheet sometimes rounds it,
  -- and an offer has to reproduce the number the client was shown.
  price_per_sqft_aed bigint NULL,
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available','on_hold','reserved','sold')),
  created_at        timestamptz(3)  NOT NULL DEFAULT now(),
  updated_at        timestamptz(3)  NOT NULL DEFAULT now(),
  -- One unit number per project. A re-import updates the row rather than
  -- adding a second unit 1204.
  CONSTRAINT uq_unit UNIQUE (project_id, unit_no),
  CONSTRAINT fk_unit_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
  CONSTRAINT fk_unit_priceversion FOREIGN KEY (price_version_id) REFERENCES unit_price_versions (id) ON DELETE SET NULL
);

-- --------------------------------------------------------------------------
-- Payment plans
-- --------------------------------------------------------------------------

CREATE TABLE payment_plans (
  id          varchar(36)     NOT NULL PRIMARY KEY,
  project_id  varchar(36)     NOT NULL,
  name        VARCHAR(160) NOT NULL,
  is_default  smallint   NOT NULL DEFAULT 0,
  note        VARCHAR(500) NULL,
  created_at  timestamptz(3)  NOT NULL DEFAULT now(),
  CONSTRAINT fk_plan_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);

CREATE TABLE payment_plan_rows (
  id         varchar(36)     NOT NULL PRIMARY KEY,
  plan_id    varchar(36)     NOT NULL,
  seq        integer NOT NULL,
  milestone  VARCHAR(200) NOT NULL,
  percent    numeric(6,3) NOT NULL,
  due_note   VARCHAR(160) NULL,
  CONSTRAINT fk_planrow_plan FOREIGN KEY (plan_id) REFERENCES payment_plans (id) ON DELETE CASCADE
);

-- --------------------------------------------------------------------------
-- Media, floor plans, amenities, documents, location
-- --------------------------------------------------------------------------

CREATE TABLE project_media (
  id           varchar(36)     NOT NULL PRIMARY KEY,
  project_id   varchar(36)     NOT NULL,
  kind text NOT NULL DEFAULT 'photo' CHECK (kind IN ('photo','video','tour_360')),
  storage_path VARCHAR(512) NULL,
  url          VARCHAR(1024) NULL,
  filename     VARCHAR(255) NULL,
  content_type VARCHAR(127) NULL,
  byte_size    bigint NULL,
  caption      VARCHAR(255) NULL,
  is_cover     smallint   NOT NULL DEFAULT 0,
  sort_order   integer NOT NULL DEFAULT 0,
  created_at   timestamptz(3)  NOT NULL DEFAULT now(),
  CONSTRAINT fk_media_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);

CREATE TABLE project_floorplans (
  id           varchar(36)     NOT NULL PRIMARY KEY,
  project_id   varchar(36)     NOT NULL,
  layout       VARCHAR(120) NOT NULL,
  storage_path VARCHAR(512) NOT NULL,
  filename     VARCHAR(255) NOT NULL,
  content_type VARCHAR(127) NOT NULL,
  byte_size    bigint NOT NULL,
  sort_order   integer NOT NULL DEFAULT 0,
  created_at   timestamptz(3)  NOT NULL DEFAULT now(),
  CONSTRAINT fk_floorplan_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);

CREATE TABLE project_amenities (
  id         varchar(36)     NOT NULL PRIMARY KEY,
  project_id varchar(36)     NOT NULL,
  name       VARCHAR(120) NOT NULL,
  enabled    smallint   NOT NULL DEFAULT 1,
  CONSTRAINT uq_amenity UNIQUE (project_id, name),
  CONSTRAINT fk_amenity_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);

CREATE TABLE project_documents (
  id           varchar(36)     NOT NULL PRIMARY KEY,
  project_id   varchar(36)     NOT NULL,
  -- "developer_offer" is special: when one is uploaded the offer builder
  -- attaches that file instead of generating its own sheet.
  kind text NOT NULL DEFAULT 'other' CHECK (kind IN ('developer_offer','brochure_en','brochure_ar','price_list','floor_plan_pack', 'master_plan','payment_plan_sheet','rera_certificate','commission_agreement', 'spa_template','other')),
  filename     VARCHAR(255) NOT NULL,
  storage_path VARCHAR(512) NOT NULL,
  content_type VARCHAR(127) NOT NULL,
  byte_size    bigint NOT NULL,
  uploaded_by_user_id varchar(36) NULL,
  created_at   timestamptz(3)  NOT NULL DEFAULT now(),
  CONSTRAINT fk_doc_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);

CREATE TABLE project_locations (
  project_id    varchar(36)      NOT NULL PRIMARY KEY,
  lat           numeric(10,7) NULL,
  lng           numeric(10,7) NULL,
  address       VARCHAR(255)  NULL,
  sales_centre  VARCHAR(255)  NULL,
  -- [{ "to": "Airport", "minutes": 25 }, …] — editable per project.
  distances     jsonb          NULL,
  CONSTRAINT fk_location_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);

-- --------------------------------------------------------------------------
-- Commission (never shown to an agent or in a client offer) and imports
-- --------------------------------------------------------------------------

CREATE TABLE project_commissions (
  project_id            varchar(36)     NOT NULL PRIMARY KEY,
  rate_pct              numeric(5,2) NULL,
  payment_terms         VARCHAR(255) NULL,
  agreement_date        DATE         NULL,
  avg_days_to_pay       integer NULL,
  default_agent_split_pct numeric(5,2) NULL,
  note                  TEXT         NULL,
  updated_at            timestamptz(3)  NOT NULL DEFAULT now(),
  CONSTRAINT fk_commission_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);

-- What the AI read out of a developer file, kept so a wrong extraction can be
-- traced back to the document it came from.
CREATE TABLE project_imports (
  id            varchar(36)     NOT NULL PRIMARY KEY,
  project_id    varchar(36)     NULL,
  source_kind text NOT NULL DEFAULT 'file' CHECK (source_kind IN ('file','link','manual')),
  source_name   VARCHAR(255) NULL,
  storage_path  VARCHAR(512) NULL,
  extracted     jsonb         NULL,
  confidence    jsonb         NULL,
  status text NOT NULL DEFAULT 'reading' CHECK (status IN ('reading','ready','confirmed','failed')),
  error         VARCHAR(500) NULL,
  confirmed_by_user_id varchar(36) NULL,
  created_by_user_id   varchar(36) NULL,
  created_at    timestamptz(3)  NOT NULL DEFAULT now(),
  CONSTRAINT fk_projectimport_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);


-- Indexes (MySQL declares these inside CREATE TABLE).
CREATE INDEX idx_developer_name ON developers (short_name);
CREATE INDEX idx_devcontact ON developer_contacts (developer_id, is_primary);
CREATE INDEX idx_priceversion ON unit_price_versions (project_id, created_at);
CREATE INDEX idx_unit_available ON units (project_id, status, price_aed);
CREATE INDEX idx_plan_project ON payment_plans (project_id, is_default);
CREATE INDEX idx_planrow ON payment_plan_rows (plan_id, seq);
CREATE INDEX idx_media_project ON project_media (project_id, kind, sort_order);
CREATE INDEX idx_floorplan_project ON project_floorplans (project_id, sort_order);
CREATE INDEX idx_doc_project ON project_documents (project_id, kind);
CREATE INDEX idx_projectimport ON project_imports (project_id, created_at);
CREATE INDEX idx_project_developer ON projects (developer_id);
CREATE INDEX idx_project_library ON projects (archived_at, sale_status, emirate);
CREATE INDEX idx_project_starred ON projects (starred, archived_at);

-- MySQL refreshes updated_at by itself; Postgres needs to be asked.
CREATE TRIGGER developers_set_updated_at BEFORE UPDATE ON developers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER units_set_updated_at BEFORE UPDATE ON units
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER project_commissions_set_updated_at BEFORE UPDATE ON project_commissions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
