BEGIN;

REVOKE ALL PRIVILEGES ON TABLE public.modules_catalog FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.modules_catalog FROM authenticated;

COMMIT;
