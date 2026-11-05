CREATE TABLE api_error_metrics (
 hour timestamptz PRIMARY KEY, error_count integer NOT NULL DEFAULT 0
);
CREATE TABLE provider_health (
 name text PRIMARY KEY, status text NOT NULL, balance numeric, checked_at timestamptz NOT NULL DEFAULT now()
);
