-- =====================================================================
-- INVESTOR UPDATE DELIVERY
--
-- `recipients` (0010) snapshots WHO an update was addressed to. This records
-- what actually happened to each of them.
--
-- Kept per recipient rather than as one status flag because partial delivery is
-- the normal failure: one stale address bounces and four land. A single
-- "sent/failed" boolean would either hide the failure or misreport the four
-- that arrived, and the person who needs to re-send to one investor needs to
-- know which one.
--
-- `send_error` holds a transport-level failure that stopped the whole send
-- (bad credentials, SMTP unreachable) as opposed to a per-address problem.
-- =====================================================================

alter table feasible.investor_updates
    add column if not exists delivery   jsonb not null default '[]'::jsonb,
    add column if not exists send_error text,
    add column if not exists sent_by    uuid references feasible.profiles (id) on delete set null;

comment on column feasible.investor_updates.delivery is
    'One entry per addressee: {name, email, ok, error, at}. Partial delivery is normal — see src/lib/mailer.ts.';
