-- =====================================================================
-- POSTAL CODE ON A PROJECT
--
-- mf_deals carried address / city / state but no postal code, which is fine for
-- an underwriting model and not fine for anything that becomes a document. A
-- commitment letter, a subscription agreement and an investor mailing all want
-- the full postal address, and stuffing "Higganum, CT 06441" into `city` to work
-- around a missing column is how a city field stops being a city field.
-- =====================================================================

alter table feasible.mf_deals
    add column if not exists postal_code text;

comment on column feasible.mf_deals.postal_code is
    'ZIP / postal code. Separate from city so generated documents can compose a proper address.';
