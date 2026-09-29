# Production RLS/Auth/Storage synthetic test

`test-production-rls.mjs` creates two temporary synthetic specialists and two
synthetic patients through the real Supabase APIs. It verifies that each of the
11 application tables hides specialist A's rows from specialist B, rejects
cross-account update/delete/owner spoofing, protects Storage prefixes and does
not expose patient rows or files to an anonymous client.

The test uses only generated `example.invalid` identities and a one-pixel test
image. A `finally` cleanup removes the Storage object, patients and Auth users.
It never prints passwords, tokens or service-role keys.

Run only from a trusted root/admin environment with the existing secrets in
environment variables:

```bash
export SUPABASE_URL=https://auth.fizira.com
export FIZIRA_RLS_E2E_CONFIRM=synthetic-production-test
node ops/security/test-production-rls.mjs
```

The environment must also contain `ANON_KEY` (or `SUPABASE_ANON_KEY`) and
`SERVICE_ROLE_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`). Do not paste either key in
the command line or commit it to Git.

Successful output:

```text
RLS_AUTH_STORAGE_SYNTHETIC_OK tables=11 cross_writes=5 storage=4 anon=2
```
