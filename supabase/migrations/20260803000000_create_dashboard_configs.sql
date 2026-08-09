-- Create dashboard_configs table for storing per-tenant widget layouts
-- Each tenant gets exactly one row with their widget layout (positions, types, configs)
create table if not exists dashboard_configs (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  layout jsonb not null default '[]'::jsonb,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- One row per tenant
create unique index if not exists dashboard_configs_tenant_id_idx on dashboard_configs (tenant_id);

-- Allow the anon role to read and upsert their own tenant's config
-- (RLS is enforced by tenant_id matching the authenticated user's workspace)
alter table dashboard_configs enable row level security;

create policy "Allow read/update for tenant own dashboard"
  on dashboard_configs
  for all
  using (tenant_id::text = auth.uid()::text)
  with check (tenant_id::text = auth.uid()::text);

-- Keep updated_at in sync
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger dashboard_configs_updated_at
  before update on dashboard_configs
  for each row execute procedure update_updated_at_column();
