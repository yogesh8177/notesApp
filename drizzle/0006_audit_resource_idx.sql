-- Per-note timeline: index to efficiently fetch audit events by resource
CREATE INDEX IF NOT EXISTS audit_log_resource_idx ON audit_log (resource_type, resource_id);
