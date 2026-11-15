// Statements the owner runs by hand in the Neon SQL editor, in this order; the README quotes them.

// After deploying the version with spaces, and again after coming forward from the earlier version: the earlier version
// changes the allowlist without touching `member` and signs people in without making their personal space. These make
// every user's personal space and its member row, set each Seattle Solvers member's role from the allowlist (adding
// whoever is missing), and remove Seattle Solvers members who are no longer on it. Safe to run again.
export const RESYNC_SPACES = [
  "insert into organization (id, name, slug, created_at, kind) select 'personal_' || id, 'Personal', 'personal_' || id, now(), 'personal' from \"user\" on conflict do nothing;",
  "insert into member (id, organization_id, user_id, role, created_at) select 'mp_' || id, 'personal_' || id, id, 'admin', now() from \"user\" on conflict do nothing;",
  "insert into member (id, organization_id, user_id, role, created_at) select 'mt_' || u.id, 'team_seattle_solvers', u.id, a.role, now() from allowlist a join \"user\" u on lower(trim(u.email)) = a.email on conflict (organization_id, user_id) do update set role = excluded.role where member.role is distinct from excluded.role;",
  "delete from member m where m.organization_id = 'team_seattle_solvers' and not exists (select 1 from allowlist a join \"user\" u on lower(trim(u.email)) = a.email where u.id = m.user_id);",
] as const;
