-- RUN THIS IN SUPABASE SQL EDITOR

-- ========= 1) Questionnaires RLS =========
alter table public.questionnaires enable row level security;

drop policy if exists "org members can select questionnaires" on public.questionnaires;
drop policy if exists "org members can insert questionnaires" on public.questionnaires;
drop policy if exists "org members can update questionnaires" on public.questionnaires;

create policy "org members can select questionnaires"
on public.questionnaires
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_memberships om
    where om.user_id = auth.uid()
      and om.organization_id = public.questionnaires.organization_id
  )
);

create policy "org members can insert questionnaires"
on public.questionnaires
for insert
to authenticated
with check (
  exists (
    select 1
    from public.organization_memberships om
    where om.user_id = auth.uid()
      and om.organization_id = public.questionnaires.organization_id
  )
);

create policy "org members can update questionnaires"
on public.questionnaires
for update
to authenticated
using (
  exists (
    select 1
    from public.organization_memberships om
    where om.user_id = auth.uid()
      and om.organization_id = public.questionnaires.organization_id
  )
)
with check (
  exists (
    select 1
    from public.organization_memberships om
    where om.user_id = auth.uid()
      and om.organization_id = public.questionnaires.organization_id
  )
);

-- ========= 2) Storage RLS (bucket: secreq) =========
-- Allows org members to upload/read:
--   - questionnaires/<orgId>/...
--   - questionnaires/<questionnaireId>/... (resolved to its org)

drop policy if exists "org members can insert to org or questionnaire folders" on storage.objects;
drop policy if exists "org members can read from org or questionnaire folders" on storage.objects;

create policy "org members can insert to org or questionnaire folders"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'secreq'
  and split_part(name, '/', 1) = 'questionnaires'
  and (
    -- org folder: questionnaires/<orgId>/...
    exists (
      select 1
      from public.organization_memberships om
      where om.user_id = auth.uid()
        and om.organization_id::text = split_part(name, '/', 2)
    )
    or
    -- questionnaire folder: questionnaires/<questionnaireId>/...
    exists (
      select 1
      from public.questionnaires q
      join public.organization_memberships om
        on om.organization_id = q.organization_id
      where q.id::text = split_part(name, '/', 2)
        and om.user_id = auth.uid()
    )
  )
);

create policy "org members can read from org or questionnaire folders"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'secreq'
  and split_part(name, '/', 1) = 'questionnaires'
  and (
    exists (
      select 1
      from public.organization_memberships om
      where om.user_id = auth.uid()
        and om.organization_id::text = split_part(name, '/', 2)
    )
    or
    exists (
      select 1
      from public.questionnaires q
      join public.organization_memberships om
        on om.organization_id = q.organization_id
      where q.id::text = split_part(name, '/', 2)
        and om.user_id = auth.uid()
    )
  )
);