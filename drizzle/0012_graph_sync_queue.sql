CREATE TABLE IF NOT EXISTS "graph_sync_queue" (
  "id" serial PRIMARY KEY,
  "operation" text NOT NULL DEFAULT 'sync',
  "node_type" text NOT NULL,
  "node_id" text NOT NULL,
  "org_id" text NOT NULL,
  "attempts" integer NOT NULL DEFAULT 0,
  "max_attempts" integer NOT NULL DEFAULT 5,
  "last_error" text,
  "scheduled_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "graph_sync_queue_scheduled_idx"
  ON "graph_sync_queue" ("scheduled_at", "attempts")
  WHERE attempts < max_attempts;

-- Wake the worker after every insert (fires after transaction commits).
CREATE OR REPLACE FUNCTION notify_graph_sync()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('graph_sync', NEW.id::text);
  RETURN NEW;
END;
$$;

CREATE TRIGGER graph_sync_notify
  AFTER INSERT ON "graph_sync_queue"
  FOR EACH ROW EXECUTE FUNCTION notify_graph_sync();
