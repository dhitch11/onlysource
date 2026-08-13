-- =============================================================================
-- 0001 FOUNDATION. Identity, org, membership, capability gates, the audit spine.
--
-- MIGRATIONS ARE APPEND-ONLY HISTORY. Once this has run anywhere, it is never edited.
-- A correction is a new numbered file.
--
-- THREE ZONES, AND CONFLATING THEM IS THE FAILURE THIS FILE EXISTS TO PREVENT.
--
--   IDENTITY PLANE (no org_id): app_user, session, account, verification.
--     A person is not org-scoped. One human, one row, many memberships. Putting org_id on
--     app_user would make the same person two people across two orgs and would break the
--     tenant flip the whole design exists to keep cheap.
--
--   ZONE A (org_id NOT NULL, RLS-ready): everything an org owns.
--     org_id on every row, composite uniqueness on (org_id, ...), cascade FK to org.
--
--   ZONE B (no org_id, no RLS): the national corpus, ingested once and read by every org.
--     Not in this migration. Keyed on NIIN(9), never full NSN. T2 owns it.
--
-- SEEDED WITH ONE ORG (ONLYSOURCE). A second org is a configuration flip: enable the
-- policies at the bottom of this file and insert a row. It is not a rewrite.
-- =============================================================================

-- gen_random_uuid() lives here on older servers; harmless on 13+.
create extension if not exists pgcrypto;

-- =============================================================================
-- ROLES. The application NEVER connects as the role that owns the tables.
--
-- A table owner bypasses row security unless the table is FORCEd, so connecting as the
-- owner makes every policy decorative while every functional test still passes. That is
-- the one defect invisible to every test, so the split is asserted in CI, not trusted.
-- =============================================================================
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_migrator') then
    -- Owns the tables. Runs migrations. The application NEVER connects as this.
    create role app_migrator login;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'app_runtime') then
    -- What the application connects as. Owns nothing. Passwords come from the environment
    -- and are set outside this file, because a password in a migration is a committed
    -- secret.
    create role app_runtime login;
  end if;
end
$$;

-- app_runtime must never acquire these. Asserted by the R2.1 harness.
alter role app_runtime nobypassrls;
alter role app_runtime nosuperuser;
alter role app_runtime nocreatedb;
alter role app_runtime nocreaterole;

-- =============================================================================
-- IDENTITY PLANE. Better Auth owns these shapes. Do not add org_id.
-- =============================================================================

create table if not exists app_user (
  id             text primary key,
  name           text not null default '',
  email          text not null,
  email_verified boolean not null default false,
  image          text,
  -- Operator-facing job title. David's two seeded users both carry "ProjectX".
  title          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
-- Global unique, and that is CORRECT here: an email identifies a human, not an org's data.
-- The same constraint on a Zone A table would be an existence oracle across orgs.
create unique index if not exists app_user_email_key on app_user (lower(email));

create table if not exists session (
  id           text primary key,
  user_id      text not null references app_user (id) on delete cascade,
  token        text not null unique,
  expires_at   timestamptz not null,
  ip_address   text,
  user_agent   text,
  -- Set when a staff member is impersonating. Read server-side to render the banner.
  impersonated_by text references app_user (id),
  -- The org this session is currently acting in. Resolved SERVER-side from membership,
  -- never from a client-supplied value. This column is what SET LOCAL app.org_id reads.
  active_organization_id uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists session_user_id_idx on session (user_id);
create index if not exists session_expires_at_idx on session (expires_at);

create table if not exists account (
  id                       text primary key,
  user_id                  text not null references app_user (id) on delete cascade,
  account_id               text not null,
  provider_id              text not null,
  access_token             text,
  refresh_token            text,
  id_token                 text,
  access_token_expires_at  timestamptz,
  refresh_token_expires_at timestamptz,
  scope                    text,
  -- Better Auth stores a hash here, never a plaintext password.
  password                 text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create unique index if not exists account_provider_key on account (provider_id, account_id);
create index if not exists account_user_id_idx on account (user_id);

create table if not exists verification (
  id         text primary key,
  identifier text not null,
  value      text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists verification_identifier_idx on verification (identifier);

-- =============================================================================
-- ZONE A. org_id NOT NULL on every table below. No exceptions.
-- =============================================================================

create table if not exists org (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null,
  logo       text,
  metadata   text,
  created_at timestamptz not null default now()
);
create unique index if not exists org_slug_key on org (slug);

-- A holding is a material or inventory SOURCE inside an org (the org's own stock, an
-- affiliated source). It is a DIMENSION beneath org_id and it is NEVER an access wall.
-- If it ever becomes one, that is a permission on top of org_id, not a replacement for it.
create table if not exists holding (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references org (id) on delete cascade,
  name       text not null,
  kind       text not null default 'internal',
  created_at timestamptz not null default now()
);
create unique index if not exists holding_org_name_key on holding (org_id, lower(name));
create index if not exists holding_org_idx on holding (org_id);

create table if not exists membership (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references org (id) on delete cascade,
  user_id    text not null references app_user (id) on delete cascade,
  -- Six roles, no more. buyer is split from admin deliberately: the person who adds a user
  -- is not always the person allowed to commit money to a supplier.
  role       text not null check (role in ('owner','admin','buyer','operator','docs','read_only')),
  status     text not null default 'active'
             check (status in ('invited','active','suspended','offboarded')),
  default_holding_id uuid references holding (id) on delete set null,
  -- Export eligibility is a legal attribute of the PERSON AT THIS ORG, not a job title.
  export_eligible     boolean not null default false,
  export_verified_by  text references app_user (id),
  export_verified_at  timestamptz,
  created_at timestamptz not null default now()
);
-- Composite on org_id. A global unique here would let one org probe another's membership.
create unique index if not exists membership_org_user_key on membership (org_id, user_id);
create index if not exists membership_user_idx on membership (user_id);
create index if not exists membership_org_idx on membership (org_id);
-- Exactly one owner per org, enforced by the database rather than by hope.
create unique index if not exists membership_single_owner_key
  on membership (org_id) where role = 'owner' and status <> 'offboarded';

create table if not exists invitation (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references org (id) on delete cascade,
  email        text not null,
  role         text not null check (role in ('owner','admin','buyer','operator','docs','read_only')),
  -- At least 128 bits from a CSPRNG, single use, email-bound, invalidated on use.
  token        text not null,
  status       text not null default 'pending'
               check (status in ('pending','accepted','revoked','expired')),
  expires_at   timestamptz not null,
  accepted_at  timestamptz,
  inviter_id   text not null references app_user (id),
  created_at   timestamptz not null default now()
);
-- GLOBAL unique, and this is the ONE justified exception to the composite-on-org_id rule.
-- An invite link is followed by somebody with no session and no org, so the token IS the
-- lookup key and cannot be scoped by an org they do not yet have. It is not the existence
-- oracle the rule guards against: the token is >=128 bits from a CSPRNG, so a colliding
-- insert only confirms a value the attacker already had to guess, and RLS still prevents
-- reading another org's invitation row. The R2.1 harness allowlists this index BY NAME and
-- asserts the allowlist has exactly one entry, so it cannot quietly grow.
create unique index if not exists invitation_token_key on invitation (token);
create unique index if not exists invitation_org_email_pending_key
  on invitation (org_id, lower(email)) where status = 'pending';
create index if not exists invitation_org_idx on invitation (org_id);

-- A capability gate is NOT a billing entitlement and NOT a rollout flag.
-- Default off IS the absence of the row. Read server-side at execution time.
create table if not exists capability_gate (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references org (id) on delete cascade,
  feature_key   text not null,
  stage         text not null,
  -- null means org-wide. A value scopes the grant to one holding.
  holding_id    uuid references holding (id) on delete cascade,
  granted_by    text not null references app_user (id),
  granted_at    timestamptz not null default now(),
  -- Numeric and queryable, never prose only, so "is this org proven" is a query and not a
  -- judgement call made under demo pressure.
  exit_criteria jsonb not null default '{}'::jsonb,
  revoked_at    timestamptz
);
-- Partial unique on the ACTIVE row: a stage promotion revokes the old row and inserts a
-- new one, so the grant history survives in the table itself, not only in the audit log.
create unique index if not exists capability_gate_active_key
  on capability_gate (org_id, feature_key, coalesce(holding_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where revoked_at is null;

-- =============================================================================
-- THE AUDIT SPINE. T1 owns this table, its migration and its grants.
-- T7 owns lib/audit/** (the write path every lane calls, and the reader).
--
-- Append-only is enforced by GRANT, not by convention: app_runtime gets INSERT and SELECT
-- and never UPDATE or DELETE. Hash-chained so a silent edit by anyone with more privilege
-- is detectable out of band.
-- =============================================================================
create table if not exists audit_event (
  id          uuid primary key default gen_random_uuid(),
  at          timestamptz not null default now(),
  org_id      uuid not null references org (id) on delete cascade,
  actor_id    text references app_user (id),
  action      text not null,
  target_type text,
  target_id   text,
  holding_id  uuid references holding (id) on delete set null,
  metadata    jsonb not null default '{}'::jsonb,
  -- The chain is per org, so one org's log cannot be verified using another's rows.
  prev_hash   text,
  row_hash    text not null
);
create index if not exists audit_event_org_at_idx on audit_event (org_id, at desc);
create index if not exists audit_event_actor_idx on audit_event (actor_id);
create index if not exists audit_event_target_idx on audit_event (target_type, target_id);

-- =============================================================================
-- GRANTS. app_runtime owns nothing and can never widen its own access.
-- =============================================================================
grant usage on schema public to app_runtime;
grant select, insert, update, delete on
  app_user, session, account, verification,
  org, holding, membership, invitation, capability_gate
  to app_runtime;

-- Append-only, at the grant layer. This is the control; the hash chain is the detector.
revoke all on audit_event from app_runtime;
grant select, insert on audit_event to app_runtime;

-- =============================================================================
-- RLS, READY BUT NOT YET ENABLED.
--
-- The policies are written now so enabling them is one statement per table rather than a
-- design exercise under pressure. They are RESTRICTIVE, not permissive: permissive policies
-- OR together, so one over-broad policy widens access, while a restrictive policy ANDs with
-- everything and can only narrow.
--
-- FORCE is applied because the owner would otherwise bypass its own policy.
--
-- Enabling is deliberately left to migration 0002 so that the seeded single-org deployment
-- and the isolation harness can both run against a known state first. The harness proves
-- the boundary holds BEFORE we depend on it.
-- =============================================================================
create or replace function current_org_id() returns uuid
language sql stable
as $$
  -- Returns NULL when unset, which makes every policy below match zero rows.
  -- Zero rows on a missing setting is the required behaviour: not an error, and never
  -- everything.
  select nullif(current_setting('app.org_id', true), '')::uuid
$$;

comment on function current_org_id() is
  'Reads the per-transaction org context set by lib/db/unit-of-work.ts via SET LOCAL. '
  'Returns NULL when unset so RLS policies match zero rows rather than all rows.';
