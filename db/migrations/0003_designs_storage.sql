-- =============================================================================
-- FEASIBLE — Migration 0003: private Storage bucket for uploaded house-design
-- plans, with owner-folder RLS.
--
-- Files live at  feasible-designs/{auth.uid()}/{uuid}.{ext}  and are managed by
-- the signed-in user's own JWT (browser client). The `postgres` role that runs
-- migrations owns storage.*, so it can both create the bucket and the policies —
-- no service-role key needed. Idempotent (guarded), same style as 0001/0002.
-- =============================================================================

insert into storage.buckets (id, name, public)
values ('feasible-designs', 'feasible-designs', false)
on conflict (id) do nothing;

-- storage.objects already has RLS enabled by Supabase. Scope each op to this
-- bucket + the user's own top-level folder (foldername[1] = their uid).
do $$ begin
  create policy "feasible_designs_select" on storage.objects
    for select to authenticated
    using (bucket_id = 'feasible-designs' and (storage.foldername(name))[1] = auth.uid()::text);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "feasible_designs_insert" on storage.objects
    for insert to authenticated
    with check (bucket_id = 'feasible-designs' and (storage.foldername(name))[1] = auth.uid()::text);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "feasible_designs_delete" on storage.objects
    for delete to authenticated
    using (bucket_id = 'feasible-designs' and (storage.foldername(name))[1] = auth.uid()::text);
exception when duplicate_object then null; end $$;
