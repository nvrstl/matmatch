-- ===========================================================================
-- Matmatch — Storage bucket for profile photos
-- Paste into the Supabase SQL Editor and run once (safe to re-run).
-- Creates a public "avatars" bucket; each user may only write files inside a
-- folder named after their own user id (e.g. "<uid>/avatar.jpg").
-- ===========================================================================

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- Anyone may read avatars (they show on public teacher profiles).
drop policy if exists "avatars public read" on storage.objects;
create policy "avatars public read" on storage.objects
  for select using (bucket_id = 'avatars');

-- A signed-in user may upload into their own "<uid>/…" folder.
drop policy if exists "avatars owner insert" on storage.objects;
create policy "avatars owner insert" on storage.objects
  for insert with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars owner update" on storage.objects;
create policy "avatars owner update" on storage.objects
  for update using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars owner delete" on storage.objects;
create policy "avatars owner delete" on storage.objects
  for delete using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
