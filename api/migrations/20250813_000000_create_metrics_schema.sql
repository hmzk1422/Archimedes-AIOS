-- =====================================================================
-- 2025-08-13  create_metrics_schema
-- Dynamic metrics storage for the customer-service-agent telemetry plane.
-- =====================================================================
--
-- The platform persists ALL observability data in ONE generic table,
-- `customer-service-provider`, keyed by (tenant_id, datatype):
--      id | tenant_id | datatype | filename | data (jsonb) | timestamp
--
-- A "metric" is simply a row with  datatype = 'telemetry_metrics'
-- whose JSONB `data` payload carries:
--      metric_name, metric_type (counter|gauge|distribution|boolean), value,
--      value_expression, tags {jsonb}, evaluation_name, score_min, score_max,
--      run_id, node_id, bot_id, unit, ts
--
-- The *same* table powers CSAT, credit-risk and school dashboards — only the
-- `tags` differ per domain. This migration materialises that contract as a
-- queryable `metrics` VIEW + indexes. No new physical table is required.
--
-- Engine write path: api/workflow_engine.py -> _execute_output_node("metrics")
-- REST writers : api/main.py -> POST /metrics | POST /metrics/bulk
-- REST reader  : api/main.py -> GET /metrics?query=... (generic, group_by/agg)

-- 1. A flattened VIEW so SQL clients and the generic GET /metrics endpoint can
--    filter / group / aggregate tags without JSON-path gymnastics.
create or replace view metrics as
select
  id,
  tenant_id,
  data ->> 'metric_name'        as metric_name,
  data ->> 'metric_type'        as metric_type,
  (data ->> 'value')::double precision as value,
  data -> 'tags'               as tags,
  data ->> 'run_id'            as run_id,
  data ->> 'node_id'           as node_id,
  data ->> 'bot_id'            as bot_id,
  data ->> 'evaluation_name'   as evaluation_name,
  (data ->> 'score_min')::double precision as score_min,
  (data ->> 'score_max')::double precision as score_max,
  data ->> 'value_expression'  as value_expression,
  data ->> 'unit'              as unit,
  timestamp
from "customer-service-provider"
where data is not null
  and data ? 'metric_name';

-- 2. Indexes that make the dynamic dashboards fast.
create index if not exists metrics_tenant_metric_idx
  on "customer-service-provider" (tenant_id)
  where datatype = 'telemetry_metrics';

create index if not exists metrics_tags_gin_idx
  on "customer-service-provider" using gin ((data -> 'tags'))
  where datatype = 'telemetry_metrics';

create index if not exists metrics_name_ts_idx
  on "customer-service-provider" (tenant_id, (data ->> 'metric_name'), timestamp desc)
  where datatype = 'telemetry_metrics';

-- 3. Row-Level Security: every tenant can only read/write its own rows.
--    Apply when a `request.tenant_id` SET middleware is wired (the service-role
--    key used by the background worker is exempt). Until then the API scopes
--    every query by `tenant_id=eq.<tenant>` itself (see /dashboard/widget-data).
--
--    enable row level security;
--    create policy "telemetry_metrics select own tenant"
--      on "customer-service-provider" for select
--      using (tenant_id = current_setting('request.tenant_id', true)::text);
--    create policy "telemetry_metrics insert own tenant"
--      on "customer-service-provider" for insert
--      with check (tenant_id = current_setting('request.tenant_id', true)::text);
--    create policy "telemetry_metrics update own tenant"
--      on "customer-service-provider" for update
--      using (tenant_id = current_setting('request.tenant_id', true)::text);
