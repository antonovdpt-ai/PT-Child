#!/usr/bin/env bash
set -Eeuo pipefail
# CI-only, public dependency source graph; deliberately does not run Fizira.
PIN=ed6c103578cbfcabe19ab0077e8eeff1305d8b3d
IMAGE=denoland/deno:2.5.6
test "${GITHUB_ACTIONS:-}" = true
test "${GITHUB_REPOSITORY:-}" = antonovdpt-ai/PT-Child
test "${GITHUB_REF:-}" = refs/heads/ci/edge-deno-cache-20261015
test -n "${RUNNER_TEMP:-}"
test "$(git rev-parse "$PIN^{commit}")" = "$PIN"
git merge-base --is-ancestor "$PIN" HEAD
git diff --quiet "$PIN" HEAD -- supabase/functions

umask 077
work=$(mktemp -d "$RUNNER_TEMP/fizira-deno.XXXXXXXX")
out="$RUNNER_TEMP/fizira-edge-cache-output"
mkdir -p "$work/source" "$work/cache" "$work/evidence" "$out"
cidfile="$work/edge-fetch.cid"
cleanup() {
  if test -s "$cidfile"; then
    cid=$(cat "$cidfile")
    if [[ "$cid" =~ ^[a-f0-9]{12,64}$ ]]; then
      docker stop --time 2 "$cid" >/dev/null 2>&1 || true
    fi
  fi
}
trap cleanup EXIT

# Exact reviewed Git snapshot; no local WSL data, prod credentials or .env.
git archive "$PIN" supabase/functions | tar -xf - -C "$work/source"
mapfile -d '' -t modules < <(find "$work/source/supabase/functions" -mindepth 2 -maxdepth 2 -type f -name index.ts -print0 | sort -z)
if test "${#modules[@]}" -ne 7; then
  echo 'BLOCKED: unexpected function count' >&2
  exit 2
fi
test -f "$work/source/supabase/functions/_shared/parent-pdf.ts"
args=()
for file in "${modules[@]}"; do
  rel=$(realpath --relative-to="$work/source" "$file")
  args+=("/src/$rel")
done
args+=(/src/supabase/functions/_shared/parent-pdf.ts
  npm:pdf-lib@1.17.1 npm:@pdf-lib/fontkit@1.1.1)

# Transient Linux container, no runner secrets, docker socket or app execution.
docker pull "$IMAGE" >/dev/null
docker image inspect "$IMAGE" --format '{{.Id}}' > "$work/evidence/deno-image-id.txt"
base=(docker run --rm --pull never --read-only --cap-drop ALL
  --security-opt no-new-privileges --pids-limit 128 --memory 1536m --cpus 2
  --user "$(id -u):$(id -g)"
  --tmpfs /tmp:rw,nosuid,nodev,size=128m,mode=1777
  --mount "type=bind,src=$work/source,dst=/src,readonly"
  --mount "type=bind,src=$work/cache,dst=/cache"
  --mount "type=bind,src=$work/evidence,dst=/out"
  --env DENO_DIR=/cache --env HOME=/tmp --env DENO_NO_UPDATE_CHECK=1
  --workdir /src --entrypoint deno)
options=(cache --no-config --no-check --node-modules-dir=none --lock=/out/deno.lock)
echo 'PUBLIC_FETCH=START'
timeout --signal=TERM --kill-after=10s 600s "${base[@]}" \
  --cidfile "$cidfile" --network bridge "$IMAGE" \
  "${options[@]}" "${args[@]}"
rm -f "$cidfile"
test -s "$work/evidence/deno.lock"
before=$(sha256sum "$work/evidence/deno.lock" | cut -d' ' -f1)

echo 'OFFLINE_RESOLUTION=START'
timeout --signal=TERM --kill-after=10s 180s "${base[@]}" \
  --cidfile "$cidfile" --network none "$IMAGE" \
  cache --cached-only --no-config --no-check --node-modules-dir=none \
  --lock=/out/deno.lock "${args[@]}"
rm -f "$cidfile"
after=$(sha256sum "$work/evidence/deno.lock" | cut -d' ' -f1)
test "$before" = "$after"
test "$(find "$work/cache" -type f | wc -l)" -gt 0
if find "$work/cache" -type l -print -quit | grep -q .; then
  echo 'BLOCKED: symlink in cache' >&2; exit 2
fi
{
  echo 'status=OFFLINE_SOURCE_GRAPH_ONLY_NOT_EDGE_REVIEWED'
  echo "source_commit=$PIN"
  echo "deno_image=$IMAGE"
  echo "deno_image_id=$(cat "$work/evidence/deno-image-id.txt")"
  echo "lock_sha256=$after"
  echo "cache_files=$(find "$work/cache" -type f | wc -l)"
  echo 'production_access=NO'
  echo 'edge_functions_executed=NO'
  echo 'runtime_compatibility_proven=NO'
  echo 'upstream_router_import_map_included=NO'
} > "$work/evidence/summary.txt"

tar -czf "$out/fizira-edge-cache-linux-ed6c103.tar.gz" -C "$work" cache evidence
size=$(stat -c '%s' "$out/fizira-edge-cache-linux-ed6c103.tar.gz")
if ((size < 100 || size > 250 * 1024 * 1024)); then
  rm -f "$out/fizira-edge-cache-linux-ed6c103.tar.gz"
  echo 'BLOCKED: archive size' >&2; exit 2
fi
sha256sum "$out/fizira-edge-cache-linux-ed6c103.tar.gz" > "$out/fizira-edge-cache-linux-ed6c103.tar.gz.sha256"
echo 'PUBLIC_LINUX_CACHE_OFFLINE_PASS'
echo 'EDGE_RUNTIME_REVIEWED=NO'
