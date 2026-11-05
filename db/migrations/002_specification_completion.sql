ALTER TABLE users ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN ui_calendar text NOT NULL DEFAULT 'jalali' CHECK(ui_calendar IN ('jalali','gregorian'));
ALTER TABLE people ADD COLUMN gender text;
ALTER TABLE people ADD COLUMN country_code varchar(2);
ALTER TABLE people ADD COLUMN industry text;
ALTER TABLE people ADD COLUMN activity_area text;
ALTER TABLE people ADD COLUMN acquaintance_notes text;
ALTER TABLE people ADD COLUMN relationship_owner_user_id uuid GENERATED ALWAYS AS (user_id) STORED REFERENCES users(id);
ALTER TABLE relationships ADD COLUMN introduced_by_person_id uuid;
ALTER TABLE relationships ADD COLUMN start_date date;
ALTER TABLE relationships ADD FOREIGN KEY(user_id,introduced_by_person_id) REFERENCES people(user_id,id);
ALTER TABLE important_dates ADD COLUMN notes text;
ALTER TABLE actions ADD COLUMN owner_user_id uuid GENERATED ALWAYS AS (user_id) STORED REFERENCES users(id);
ALTER TABLE flower_details ADD COLUMN delivery_local_time text;
ALTER TABLE flower_details ADD COLUMN timezone text NOT NULL DEFAULT 'Asia/Tehran';
ALTER TABLE flower_details ADD COLUMN notes text;
ALTER TABLE florists ADD COLUMN archived_at timestamptz;
ALTER TABLE reminders ADD COLUMN recipient_kind text GENERATED ALWAYS AS (CASE WHEN recipient_person_id IS NULL THEN 'user' ELSE 'person' END) STORED;
ALTER TABLE reminders ADD COLUMN recipient_user_id uuid GENERATED ALWAYS AS (CASE WHEN recipient_person_id IS NULL THEN user_id ELSE NULL END) STORED REFERENCES users(id);
ALTER TABLE reminders ADD CONSTRAINT in_app_owner_only CHECK(channel<>'in_app' OR recipient_person_id IS NULL);
ALTER TABLE outbox_messages ADD COLUMN preview_fingerprint text;
ALTER TABLE outbox_messages ADD COLUMN recipient_kind text;
ALTER TABLE outbox_messages ADD COLUMN recipient_id uuid;
ALTER TABLE sms_logs ADD COLUMN recipient_mobile_snapshot text;
ALTER TABLE sms_logs ADD COLUMN message_snapshot text;
ALTER TABLE sms_logs ADD COLUMN provider_message_id text;
ALTER TABLE sms_logs ADD COLUMN delivery_status text;
ALTER TABLE interactions ADD COLUMN direction text CHECK(direction IN ('incoming','outgoing'));
ALTER TABLE interactions ADD COLUMN related_message_id uuid;
ALTER TABLE interactions ADD COLUMN created_by_user_id uuid GENERATED ALWAYS AS (user_id) STORED REFERENCES users(id);
ALTER TABLE interactions ADD FOREIGN KEY(user_id,related_message_id) REFERENCES outbox_messages(user_id,id);
ALTER TABLE audit_logs ADD COLUMN actor_user_id uuid REFERENCES users(id);
ALTER TABLE audit_logs ADD COLUMN request_id uuid;
ALTER TABLE audit_logs ADD COLUMN outcome text NOT NULL DEFAULT 'success';
ALTER TABLE import_jobs ADD COLUMN external_references jsonb NOT NULL DEFAULT '{}';
ALTER TABLE import_jobs ADD COLUMN purged_at timestamptz;
ALTER TABLE import_jobs ADD COLUMN error_message text;

CREATE INDEX imports_checksum ON import_jobs(user_id,checksum,created_at DESC);
CREATE TABLE operational_alerts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
 code text NOT NULL, is_active boolean NOT NULL DEFAULT true, detail text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,code)
);
CREATE INDEX actions_person_due ON actions(user_id,person_id,status,due_at);
CREATE INDEX notifications_owner_cursor ON notifications(user_id,id);
CREATE INDEX outbox_owner_cursor ON outbox_messages(user_id,id);
CREATE INDEX interactions_contact ON interactions(user_id,person_id,occurred_at DESC) WHERE counts_as_contact;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX people_search_trigram ON people USING gin(normalized_search gin_trgm_ops);
CREATE INDEX tags_search_trigram ON tags USING gin(normalized_name gin_trgm_ops);
ALTER TABLE tags ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE tags ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE relationship_types ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE relationship_types ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE flower_details ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE flower_details ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE FUNCTION relationship_touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at=now(); RETURN NEW; END $$;
CREATE TRIGGER tags_updated BEFORE UPDATE ON tags FOR EACH ROW EXECUTE FUNCTION relationship_touch_updated_at();
CREATE TRIGGER relationship_types_updated BEFORE UPDATE ON relationship_types FOR EACH ROW EXECUTE FUNCTION relationship_touch_updated_at();
CREATE TRIGGER flowers_updated BEFORE UPDATE ON flower_details FOR EACH ROW EXECUTE FUNCTION relationship_touch_updated_at();
