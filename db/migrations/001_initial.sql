CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE, password_hash text NOT NULL, display_name text NOT NULL,
 timezone text NOT NULL DEFAULT 'Asia/Tehran', locale text NOT NULL DEFAULT 'fa-IR', florist_send_local_time text NOT NULL DEFAULT '09:00',
 sms_enabled boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, csrf_token text NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE login_attempts (key text PRIMARY KEY, attempts int NOT NULL DEFAULT 1, reset_at timestamptz NOT NULL);
CREATE TABLE people (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id), first_name varchar(100) NOT NULL, last_name varchar(100),
 display_name text NOT NULL, normalized_search text NOT NULL, mobile varchar(20), email text, city text, address text, company text, job_title text,
 notes text, private_notes text, photo_key text, importance_level char(1) NOT NULL DEFAULT 'B' CHECK(importance_level IN ('A','B','C')),
 is_active boolean NOT NULL DEFAULT true, is_self boolean NOT NULL DEFAULT false,
 introduction_source text NOT NULL DEFAULT 'direct' CHECK(introduction_source IN ('direct','person','unknown')), introduced_by_person_id uuid,
 first_met_on date, archived_at timestamptz, version int NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,id),
 FOREIGN KEY(user_id,introduced_by_person_id) REFERENCES people(user_id,id), CHECK(introduced_by_person_id IS DISTINCT FROM id),
 CHECK((introduction_source='person')=(introduced_by_person_id IS NOT NULL))
);
CREATE UNIQUE INDEX people_one_self ON people(user_id) WHERE is_self;
CREATE INDEX people_search ON people(user_id,normalized_search);
CREATE INDEX people_mobile ON people(user_id,mobile);
CREATE TABLE tags (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id), name varchar(80) NOT NULL, normalized_name text NOT NULL, kind text NOT NULL DEFAULT 'expertise' CHECK(kind IN ('expertise','label')), is_active boolean NOT NULL DEFAULT true, UNIQUE(user_id,id), UNIQUE(user_id,normalized_name,kind));
CREATE TABLE person_tags (user_id uuid NOT NULL, person_id uuid NOT NULL, tag_id uuid NOT NULL, PRIMARY KEY(user_id,person_id,tag_id), FOREIGN KEY(user_id,person_id) REFERENCES people(user_id,id), FOREIGN KEY(user_id,tag_id) REFERENCES tags(user_id,id));
CREATE TABLE relationship_types (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id), code text NOT NULL, label text NOT NULL, reverse_label text, is_directed boolean NOT NULL DEFAULT false, is_active boolean NOT NULL DEFAULT true, UNIQUE(user_id,id), UNIQUE(user_id,code));
CREATE TABLE relationships (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, person_a_id uuid NOT NULL, person_b_id uuid NOT NULL, relationship_type_id uuid NOT NULL,
 notes text, archived_at timestamptz, version int NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,id), FOREIGN KEY(user_id,person_a_id) REFERENCES people(user_id,id), FOREIGN KEY(user_id,person_b_id) REFERENCES people(user_id,id),
 FOREIGN KEY(user_id,relationship_type_id) REFERENCES relationship_types(user_id,id), CHECK(person_a_id<>person_b_id)
);
CREATE UNIQUE INDEX relationship_unique_active ON relationships(user_id,relationship_type_id,person_a_id,person_b_id) WHERE archived_at IS NULL;
CREATE INDEX relationships_from ON relationships(user_id,person_a_id);
CREATE INDEX relationships_to ON relationships(user_id,person_b_id);
CREATE TABLE important_dates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, person_id uuid NOT NULL, title text NOT NULL, kind text NOT NULL DEFAULT 'custom',
 calendar text NOT NULL CHECK(calendar IN ('jalali','gregorian')), original_year int, month int NOT NULL CHECK(month BETWEEN 1 AND 12), day int NOT NULL CHECK(day BETWEEN 1 AND 31), event_date date,
 recurrence text NOT NULL DEFAULT 'yearly' CHECK(recurrence IN ('none','yearly')), leap_policy text NOT NULL DEFAULT 'last_valid_day' CHECK(leap_policy IN ('last_valid_day','skip')),
 is_active boolean NOT NULL DEFAULT true, version int NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,id), FOREIGN KEY(user_id,person_id) REFERENCES people(user_id,id), CHECK(recurrence<>'none' OR event_date IS NOT NULL)
);
CREATE UNIQUE INDEX date_one_birthday ON important_dates(user_id,person_id) WHERE kind='birthday' AND is_active;
CREATE TABLE florists (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id), name text NOT NULL, mobile text NOT NULL, notes text, is_active boolean NOT NULL DEFAULT true, version int NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,id));
CREATE TABLE actions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, person_id uuid NOT NULL, important_date_id uuid, occurrence_date date,
 action_type text NOT NULL CHECK(action_type IN ('call','message','meeting','gift','flower','reminder','custom')), title text NOT NULL, due_at timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','done','cancelled')), completed_at timestamptz, notes text, version int NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,id),
 FOREIGN KEY(user_id,person_id) REFERENCES people(user_id,id), FOREIGN KEY(user_id,important_date_id) REFERENCES important_dates(user_id,id),
 CHECK(important_date_id IS NULL OR occurrence_date IS NOT NULL)
);
CREATE INDEX actions_due ON actions(user_id,status,due_at);
CREATE TABLE flower_details (action_id uuid PRIMARY KEY, user_id uuid NOT NULL, florist_id uuid NOT NULL, budget_amount bigint NOT NULL CHECK(budget_amount>0), currency text NOT NULL DEFAULT 'IRT' CHECK(currency IN ('IRT','IRR')), delivery_date date NOT NULL, delivery_address text NOT NULL, card_message text NOT NULL DEFAULT '', version int NOT NULL DEFAULT 1, sms_accepted_at timestamptz, FOREIGN KEY(user_id,action_id) REFERENCES actions(user_id,id), FOREIGN KEY(user_id,florist_id) REFERENCES florists(user_id,id));
CREATE TABLE reminders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id), person_id uuid, important_date_id uuid, action_id uuid,
 channel text NOT NULL DEFAULT 'in_app' CHECK(channel IN ('in_app','sms')), recipient_person_id uuid, message text NOT NULL,
 schedule_mode text NOT NULL DEFAULT 'once' CHECK(schedule_mode IN ('once','per_occurrence')), scheduled_at timestamptz, offset_days int NOT NULL DEFAULT 0,
 local_time text NOT NULL DEFAULT '09:00', timezone text NOT NULL DEFAULT 'Asia/Tehran', is_enabled boolean NOT NULL DEFAULT true, version int NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,id),
 FOREIGN KEY(user_id,person_id) REFERENCES people(user_id,id), FOREIGN KEY(user_id,important_date_id) REFERENCES important_dates(user_id,id), FOREIGN KEY(user_id,action_id) REFERENCES actions(user_id,id), FOREIGN KEY(user_id,recipient_person_id) REFERENCES people(user_id,id),
 CHECK(num_nonnulls(person_id,important_date_id,action_id)=1), CHECK(schedule_mode<>'per_occurrence' OR important_date_id IS NOT NULL), CHECK(schedule_mode<>'once' OR scheduled_at IS NOT NULL)
);
CREATE TABLE outbox_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id), dedupe_key text NOT NULL, action_id uuid, reminder_id uuid, occurrence_date date,
 channel text NOT NULL CHECK(channel IN ('in_app','sms')), payload_snapshot text, schedule_version int NOT NULL, scheduled_at timestamptz NOT NULL, deadline_at timestamptz,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','retry_wait','processing','accepted','delivered','failed','unknown','cancelled','expired')),
 attempt_count int NOT NULL DEFAULT 0, next_attempt_at timestamptz, locked_until timestamptz, provider_message_id text, error_code text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,id), UNIQUE(user_id,dedupe_key),
 FOREIGN KEY(user_id,action_id) REFERENCES actions(user_id,id), FOREIGN KEY(user_id,reminder_id) REFERENCES reminders(user_id,id)
);
CREATE INDEX outbox_ready ON outbox_messages(state,next_attempt_at,scheduled_at);
CREATE TABLE notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id), outbox_message_id uuid, title text NOT NULL, body text NOT NULL, related_entity_id uuid, read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,outbox_message_id), FOREIGN KEY(user_id,outbox_message_id) REFERENCES outbox_messages(user_id,id));
CREATE TABLE interactions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, person_id uuid NOT NULL, occurred_at timestamptz NOT NULL, interaction_type text NOT NULL,
 notes text, source text NOT NULL DEFAULT 'manual', related_action_id uuid, counts_as_contact boolean NOT NULL DEFAULT true, dedupe_key text,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,id), UNIQUE(user_id,dedupe_key), FOREIGN KEY(user_id,person_id) REFERENCES people(user_id,id), FOREIGN KEY(user_id,related_action_id) REFERENCES actions(user_id,id)
);
CREATE INDEX interactions_timeline ON interactions(user_id,person_id,occurred_at DESC);
CREATE TABLE sms_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, outbox_message_id uuid NOT NULL, attempt_no int NOT NULL, provider text NOT NULL, send_status text NOT NULL, error_code text, requested_at timestamptz NOT NULL DEFAULT now(), responded_at timestamptz, UNIQUE(outbox_message_id,attempt_no), FOREIGN KEY(user_id,outbox_message_id) REFERENCES outbox_messages(user_id,id));
CREATE TABLE import_jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id), filename text NOT NULL, checksum text NOT NULL, status text NOT NULL DEFAULT 'preview', staged_data text NOT NULL, result jsonb, mapping jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days', UNIQUE(user_id,id));
CREATE TABLE idempotency_requests (user_id uuid NOT NULL REFERENCES users(id), route text NOT NULL, idempotency_key text NOT NULL, request_hash text NOT NULL, response_body jsonb NOT NULL, response_code int NOT NULL, expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days', PRIMARY KEY(user_id,route,idempotency_key));
CREATE TABLE audit_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id), event text NOT NULL, entity_type text NOT NULL, entity_id uuid, changed_fields text[] NOT NULL DEFAULT '{}', occurred_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE worker_health (name text PRIMARY KEY, last_seen_at timestamptz NOT NULL DEFAULT now());
