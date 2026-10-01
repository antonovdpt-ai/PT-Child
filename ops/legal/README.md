# Fizira legal release deployment

## Source-of-truth gate

Before this change was prepared, the nine frontend assets served by
`app.fizira.com` were compared by SHA-256 with `main` at
`9087fe4719576f163b01ee85c6bff09008c35f7e`; every file matched. The landing
page was different: its complete source existed only on Timeweb. The current
production landing assets were therefore captured under `landing/` before any
edits. Future landing deployments use these committed files and no longer copy
an unknown live page back onto itself.

Repeat the comparison before deployment if production may have been edited
manually after this commit. Never deploy an older checkout over a mismatching
production tree.

## Safe production order

1. Confirm a recent encrypted off-server backup exists.
2. On Timeweb, start the installed full backup service:

   ```bash
   sudo systemctl start fizira-backup.service
   sudo journalctl -u fizira-backup.service --no-pager -n 100
   ```

   Require `AUTOMATED_BACKUP_OK` in the service log. Do not continue if the
   unit is missing, failed, or the success marker is absent.

3. Copy `supabase/migrations/20260930_007_legal_acceptances.sql` to a private
   temporary path on the server and verify its SHA-256 against the reviewed
   commit.
4. Apply the migration from `/root/supabase-project`:

   ```bash
   docker compose exec -T db \
     psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - \
     < /private/path/20260930_007_legal_acceptances.sql
   ```

5. Run `ops/legal/verify-production.sql` through the same `psql` command. The
   migration is additive, preserves legacy combined consent rows, and installs
   a server trigger that records new signup consent before email confirmation.
6. Merge the reviewed commit. The frontend and landing workflows then deploy
   the static files. Each workflow creates a server-side pre-deploy snapshot.
7. Verify `/privacy`, `/terms`, `/consent`, `/data-processing`, and
   `/delete-account`, then run one synthetic registration and confirm three
   per-document acceptance records.

## Rollback policy

Do not drop acceptance records after users have registered: they are audit
evidence. If the new UI must be rolled back, redeploy the previous static
frontend and landing snapshots while leaving the additive columns, function,
and acceptance rows in place. Repair the database forward instead of deleting
legal history.

The migration must be applied before the new registration frontend is exposed.
Existing accounts remain usable even when they only have legacy
`pre-release-v1` metadata; login is not blocked and legacy records are
backfilled per document.
