-- =====================================================================
-- MULTI-FAMILY COST PROGRAM + PROFORMA LINE DETAIL
--
-- Two additions to mf_deals, both JSONB, both for the same reason the
-- `assumptions` column is JSONB (see 0005): they are read and written whole by a
-- single editor, they are versioned by the app, and the shape is still moving.
--
--   cost_program  The development budget — finish level, common areas (attached
--                 and detached), the parking program, site infrastructure, and
--                 the soft-cost loads. Replaces "type a total project cost" with
--                 a number built up from what the developer actually decides.
--                 Carries its own useComputed/overrideTotal, so total_project_cost
--                 stays meaningful as the hand-typed fallback.
--
--   line_details  Per-line overrides for the stabilized proforma. Each key is a
--                 line label exactly as it renders ("Insurance", "Taxes"), each
--                 value is { mode, items[], note }. Absent means every line uses
--                 its standardized per-unit estimate — which is what every
--                 existing deal does, so this migration changes no numbers.
--
-- Both default to '{}' so loading an old deal produces the same underwrite it did
-- before. Nothing here is destructive; total_project_cost is untouched.
-- =====================================================================

alter table feasible.mf_deals
    add column if not exists cost_program jsonb not null default '{}'::jsonb,
    add column if not exists line_details jsonb not null default '{}'::jsonb;

comment on column feasible.mf_deals.cost_program is
    'Development budget: finish level, common areas, parking program, infrastructure, soft costs. See src/lib/mf-costs.ts.';
comment on column feasible.mf_deals.line_details is
    'Per-line proforma overrides keyed by line label. See LineDetails in src/lib/multifamily.ts.';
