-- Indexes Postgres does not create for you.
--
-- InnoDB builds an index for every foreign key by itself, so the MySQL schema
-- never had to declare these. Postgres does not: without them every cascading
-- delete and every join on these columns is a sequential scan, which is slow
-- in a way that only shows up once the table is large — by which point it
-- reads as "the new database is slow" rather than as a missing index.
--
-- 27 foreign keys had no index leading with their own column.

CREATE INDEX idx_fk_ai_knowledge_updated_by_user_id ON ai_knowledge (updated_by_user_id);
CREATE INDEX idx_fk_ai_knowledge_versions_updated_by_user_id ON ai_knowledge_versions (updated_by_user_id);
CREATE INDEX idx_fk_ai_usage_user_id ON ai_usage (user_id);
CREATE INDEX idx_fk_app_secrets_updated_by_user_id ON app_secrets (updated_by_user_id);
CREATE INDEX idx_fk_app_settings_updated_by_user_id ON app_settings (updated_by_user_id);
CREATE INDEX idx_fk_assignment_rules_target_user_id ON assignment_rules (target_user_id);
CREATE INDEX idx_fk_campaign_members_assigned_user_id ON campaign_members (assigned_user_id);
CREATE INDEX idx_fk_campaign_members_contact_id ON campaign_members (contact_id);
CREATE INDEX idx_fk_campaign_members_opportunity_id ON campaign_members (opportunity_id);
CREATE INDEX idx_fk_campaigns_created_by_user_id ON campaigns (created_by_user_id);
CREATE INDEX idx_fk_conversion_events_contact_id ON conversion_events (contact_id);
CREATE INDEX idx_fk_import_mappings_created_by_user_id ON import_mappings (created_by_user_id);
CREATE INDEX idx_fk_import_rows_opportunity_id ON import_rows (opportunity_id);
CREATE INDEX idx_fk_lead_pool_claims_contact_id ON lead_pool_claims (contact_id);
CREATE INDEX idx_fk_list_members_opportunity_id ON list_members (opportunity_id);
CREATE INDEX idx_fk_lists_created_by_user_id ON lists (created_by_user_id);
CREATE INDEX idx_fk_messages_user_id ON messages (user_id);
CREATE INDEX idx_fk_offer_events_offer_unit_id ON offer_events (offer_unit_id);
CREATE INDEX idx_fk_offer_events_view_id ON offer_events (view_id);
CREATE INDEX idx_fk_offer_folders_created_by ON offer_folders (created_by);
CREATE INDEX idx_fk_offers_created_by ON offers (created_by);
CREATE INDEX idx_fk_offers_opportunity_id ON offers (opportunity_id);
CREATE INDEX idx_fk_offers_project_id ON offers (project_id);
CREATE INDEX idx_fk_opportunities_stage_id ON opportunities (stage_id);
CREATE INDEX idx_fk_task_attachments_uploaded_by_user_id ON task_attachments (uploaded_by_user_id);
CREATE INDEX idx_fk_units_price_version_id ON units (price_version_id);
CREATE INDEX idx_fk_workflow_runs_contact_id ON workflow_runs (contact_id);
