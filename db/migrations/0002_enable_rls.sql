-- =============================================================================
-- 0002 ENABLE ROW LEVEL SECURITY on every Zone A table.
--
-- Split from 0001 deliberately: 0001 establishes the shape, this one turns the boundary on,
-- and the R2.1 harness proves it holds. Enabling and proving are separate steps because a
-- policy nobody tested is a policy nobody has.
--
-- FOUR PROPERTIES, EACH ONE THE ANSWER TO A SPECIFIC WAY THIS GOES WRONG.
--
--   1. FORCE ROW LEVEL SECURITY.
--      Without it the table OWNER bypasses its own policy, so every policy is decorative
--      while every functional test passes. This is the one defect invisible to testing.
--
--   2. RESTRICTIVE, not permissive.
--      Permissive policies OR together, so adding one over-broad policy silently widens
--      access to everything. A restrictive policy ANDs with every other policy and can
--      therefore only ever narrow. Adding a bad restrictive policy locks people out, which
--      is loud. Adding a bad permissive policy leaks data, which is silent.
--
--   3. Scoped TO app_runtime.
--      Migrations and out-of-band repair connect as app_migrator and are not fighting the
--      policy. The application role is the only one the policy governs.
--
--   4. current_org_id() returns NULL when the setting is absent, and NULL = anything is
--      NULL, which is not true, so an unset context matches ZERO rows. Not an error, and
--      never everything. A fail-open default here would be indistinguishable from working
--      software right up until the day two orgs exist.
-- =============================================================================

-- A permissive baseline is required alongside a restrictive policy: RESTRICTIVE policies
-- only narrow what a PERMISSIVE policy already allowed, and with no permissive policy at
-- all the default is deny-everything. So each table gets one permissive "the row belongs to
-- my org" policy and the restrictive one AND-ed on top as the second line of defence.

do $$
declare
  t text;
begin
  foreach t in array array['org','holding','membership','invitation','capability_gate','audit_event']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end
$$;

-- ---------------------------------------------------------------- org
-- `org` is scoped on its own id rather than an org_id column.
create policy org_isolation on org
  for all to app_runtime
  using (id = current_org_id())
  with check (id = current_org_id());

create policy org_isolation_restrictive on org
  as restrictive for all to app_runtime
  using (id = current_org_id())
  with check (id = current_org_id());

-- ------------------------------------------------- every other Zone A table
do $$
declare
  t text;
begin
  foreach t in array array['holding','membership','invitation','capability_gate','audit_event']
  loop
    execute format($f$
      create policy %1$I_isolation on %1$I
        for all to app_runtime
        using (org_id = current_org_id())
        with check (org_id = current_org_id())
    $f$, t);

    execute format($f$
      create policy %1$I_isolation_restrictive on %1$I
        as restrictive for all to app_runtime
        using (org_id = current_org_id())
        with check (org_id = current_org_id())
    $f$, t);
  end loop;
end
$$;

-- The policy column is indexed on every table above (see 0001). That is one of the five
-- measured RLS performance rules; without it the planner filters after the scan and the
-- policy becomes the bottleneck people then blame RLS for.
