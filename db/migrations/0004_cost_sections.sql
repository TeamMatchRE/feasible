-- Cost catalog gains a "section" so the Costs grid can split into two tabs:
-- "Building Components" (the home itself) and "Infrastructure" (site/land/soft costs).
-- Existing rows are all home components, so the default is correct; ensureCatalog()
-- re-canonicalises category/section per item on next load.
alter table feasible.cost_catalog_items
  add column if not exists section text not null default 'Building Components';

create index if not exists cost_catalog_items_section_idx
  on feasible.cost_catalog_items (owner_id, section);
