-- =====================================================================
-- PER-UNIT-TYPE COST BASIS
--
-- The cost program (0006) carries ONE residential $/SF and ONE circulation
-- efficiency, applied to every unit in the deal. That is right for a single
-- apartment building — one structure, one finish level, one corridor system —
-- and wrong for any deal that builds more than one product type.
--
-- A for-sale subdivision blended with build-to-rent is the case that breaks it.
-- Detached houses, attached townhomes and stacked flats are three different
-- buildings at three different unit costs, and only the stacked flats have the
-- interior corridors, elevators and shared lobbies that the efficiency factor
-- exists to pay for. Grossing a detached house by 0.85 invents 17.6% of hard
-- cost that nobody will ever build.
--
-- So each unit type may carry its own rate and its own grossing:
--
--   cost_per_sf   Hard cost $/SF for this product. NULL = follow the program's
--                 residentialCostPerSf (or the finish level).
--   gross_factor  Net-to-gross divisor for this product. NULL = follow the
--                 program's circulationEfficiency. 1.0 = no grossing, which is
--                 the honest answer for a detached house or a townhome whose
--                 quoted $/SF is already the whole building.
--
-- BOTH DEFAULT TO NULL, so every existing deal computes exactly the number it
-- computed before this migration. See the backward-compatibility test in
-- src/lib/mf-costs.test.ts, which asserts that equivalence rather than trusting
-- it.
-- =====================================================================

-- The same deal needs to say WHICH products it sells and which it holds. Without
-- it, a blended program can only be expressed as "sell 45% of every type", which
-- charges the held asset with houses it doesn't own. NULL keeps the old
-- proration model; see Disposition in src/lib/multifamily.ts.
alter table feasible.mf_unit_types
    add column if not exists cost_per_sf  numeric(10,2),
    add column if not exists gross_factor numeric(6,4),
    add column if not exists disposition  text
        check (disposition is null or disposition in ('sell', 'hold'));

comment on column feasible.mf_unit_types.cost_per_sf is
    'Hard cost $/SF for this product type. NULL = follow the cost program''s residential rate.';
comment on column feasible.mf_unit_types.gross_factor is
    'Net-to-gross divisor for this product type. NULL = follow the program''s circulationEfficiency; 1.0 = no grossing (detached / townhome).';
comment on column feasible.mf_unit_types.disposition is
    'sell | hold. NULL on every row = the deal prorates by sellOut.shareSold (original behaviour). Any non-NULL row switches the deal to designated mode.';
