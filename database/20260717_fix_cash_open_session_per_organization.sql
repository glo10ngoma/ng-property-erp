BEGIN;

DROP INDEX IF EXISTS public.cash_one_open_session;

CREATE UNIQUE INDEX cash_one_open_session_per_organization
ON public.cash_sessions (organization_id)
WHERE status = 'OPEN';

COMMIT;
