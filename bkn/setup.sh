#!/usr/bin/env bash
# Install (or update) the matériauthèque on a running bkn. Idempotent.
#
#   BKN_URL=https://bkn.vps1.intrane.fr BKN_ADMIN_TOKEN=... \
#   MAT_ADMIN_TOKEN=<moderation secret> \
#   REGISTER_URL=https://registre-bauges.vps1.intrane.fr REGISTER_TOKEN=<greffe put_token> \
#   ALLOW_ORIGIN=https://enbauges.fr ./bkn/setup.sh
#
# What it does: stores the moderation token and the register settings in kv, declares the two
# collections (admin-only; the hook is the only public surface), and creates/updates the hook
# bound to hook.js with CORS for the site, a rate limit, and outbound access to the register.
# The bkn CLI writes to the database it is pointed at (BKN_DATA / BKN_HOME), not to a remote
# server, so run this ON the machine that runs bkn — or set BKN to a wrapper that does, e.g.
#   BKN="docker exec -e BKN_HOME=/data bkn-enbauges /app/bkn"  HOOK_PATH=/data/materiautheque-hook.js
# after copying hook.js where that wrapper can read it.
set -euo pipefail
cd "$(dirname "$0")"
: "${MAT_ADMIN_TOKEN:?}"
BKN=${BKN:-bkn}
HOOK_PATH=${HOOK_PATH:-hook.js}
ALLOW_ORIGIN=${ALLOW_ORIGIN:-https://enbauges.fr}
REGISTER_HOST=$(echo "${REGISTER_URL:-}" | sed -E 's#^https?://##; s#/.*##')

$BKN kv set materiautheque.admin_token "$MAT_ADMIN_TOKEN" --description "matériauthèque: X-Admin-Token for moderation" >/dev/null
if [[ -n "${REGISTER_URL:-}" ]]; then
  $BKN kv set materiautheque.register_url "$REGISTER_URL" --description "greffe node that records the matériauthèque" >/dev/null
  $BKN kv set materiautheque.register_token "${REGISTER_TOKEN:?}" --description "greffe put_token" >/dev/null
  $BKN kv set materiautheque.register_public_url "${REGISTER_PUBLIC_URL:-$REGISTER_URL/ui}" --description "public explorer link shown on the page" >/dev/null
fi
$BKN store create materiautheque/items --normalize commune=trim >/dev/null 2>&1 || true
$BKN store create materiautheque/proposals >/dev/null 2>&1 || true

if $BKN script show materiautheque >/dev/null 2>&1; then
  $BKN script update materiautheque --file "$HOOK_PATH" --allow-net "${REGISTER_HOST:-none.invalid}" --timeout 8000 >/dev/null
else
  $BKN script create materiautheque --file "$HOOK_PATH" --description "matériauthèque: public list + proposals + moderation + register mirror" --allow-net "${REGISTER_HOST:-none.invalid}" --timeout 8000 >/dev/null
fi
if $BKN hooks show materiautheque >/dev/null 2>&1; then
  $BKN hooks update materiautheque --script materiautheque --max-bytes 65536 --allow-origin "$ALLOW_ORIGIN" --rate-limit 60 --enable >/dev/null
else
  $BKN hooks create materiautheque --script materiautheque --max-bytes 65536 --allow-origin "$ALLOW_ORIGIN" --rate-limit 60 >/dev/null
fi
echo "matériauthèque installed via $BKN — hook: /v1/hooks/materiautheque (origin $ALLOW_ORIGIN, register ${REGISTER_URL:-off})"
