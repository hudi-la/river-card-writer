-- Only hashes are stored; bearer secrets are shown once in the browser.
create table if not exists public.cw_mcp_tokens (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id) on delete cascade default auth.uid(),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  parent_id uuid references public.cw_mcp_tokens(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 days')
);
alter table public.cw_mcp_tokens enable row level security;
create policy "Read own MCP keys" on public.cw_mcp_tokens for select to authenticated using (owner = auth.uid());
create policy "Create own MCP keys" on public.cw_mcp_tokens for insert to authenticated with check (owner = auth.uid() and parent_id is null and expires_at <= now() + interval '90 days');
create policy "Revoke own MCP keys" on public.cw_mcp_tokens for delete to authenticated using (owner = auth.uid());
grant select, insert, delete on public.cw_mcp_tokens to authenticated;
revoke all on public.cw_mcp_tokens from anon;

create table public.cw_mcp_clients (
  id uuid primary key default gen_random_uuid(),
  redirect_uris jsonb not null,
  created_at timestamptz not null default now()
);
create table public.cw_mcp_codes (
  code_hash text primary key,
  parent_id uuid not null references public.cw_mcp_tokens(id) on delete cascade,
  client_id uuid not null references public.cw_mcp_clients(id) on delete cascade,
  redirect_uri text not null,
  challenge text not null,
  expires_at timestamptz not null default (now() + interval '5 minutes')
);
alter table public.cw_mcp_clients enable row level security;
alter table public.cw_mcp_codes enable row level security;
revoke all on public.cw_mcp_clients, public.cw_mcp_codes from anon, authenticated;
