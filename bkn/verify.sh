#!/usr/bin/env bash
# Live assertions against a running bkn (never a mock): BKN_URL, MAT_ADMIN_TOKEN required.
set -uo pipefail
: "${BKN_URL:?}" "${MAT_ADMIN_TOKEN:?}"
H="$BKN_URL/v1/hooks/materiautheque"; PASS=0; FAIL=0
chk() { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); printf "   \033[32mok\033[0m   %-58s %s\n" "$1" "$2"; else FAIL=$((FAIL+1)); printf "   \033[31mFAIL\033[0m %-58s got %s want %s\n" "$1" "$2" "$3"; fi; }
j() { python3 -c "import sys,json; d=json.load(sys.stdin); print(eval(sys.argv[1]))" "$1"; }
post() { curl -s -H 'Content-Type: application/json' -X POST "$H" -d "$1"; }
apost() { curl -s -H 'Content-Type: application/json' -H "X-Admin-Token: $MAT_ADMIN_TOKEN" -X POST "$H" -d "$1"; }
echo "=== materiautheque on $BKN_URL ==="
chk "public list answers" "$(curl -s "$H" | j "d['ok']")" "True"
chk "meta lists the communes" "$(curl -s "$H?view=meta" | j "'Le Châtelard' in d['communes']")" "True"
chk "pending view needs the admin token" "$(curl -s -o /dev/null -w '%{http_code}' "$H?view=pending")" "401"
chk "a proposal without contact is refused, field named" "$(post '{"action":"propose","item":{"title":"Tuiles","category":"autre","commune":"Arith","mode":"don"}}' | j "d['field']")" "contact"
ID=$(post '{"action":"propose","item":{"title":"Tuiles terre cuite (verify)","description":"~200 tuiles, bon état","category":"autre","commune":"Arith","mode":"don","quantity":"200","contact":"06 00 00 00 00"}}' | j "d['id']")
chk "a valid proposal is stored as pending" "$(curl -s -H "X-Admin-Token: $MAT_ADMIN_TOKEN" "$H?view=pending" | j "any(i['id']=='$ID' for i in d['items'])")" "True"
chk "a proposal is not public before moderation" "$(curl -s "$H" | j "any(i.get('proposal_id')=='$ID' for i in d['items'])")" "False"
chk "moderation without token is refused" "$(curl -s -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -X POST "$H" -d "{\"action\":\"approve\",\"id\":\"$ID\"}")" "401"
AP=$(apost "{\"action\":\"approve\",\"id\":\"$ID\"}"); IID=$(echo "$AP" | j "d['id']")
chk "approval publishes the item" "$(curl -s "$H" | j "any(i['id']=='$IID' for i in d['items'])")" "True"
chk "approval is recorded in the public register" "$(echo "$AP" | j "'id' in d['register']")" "True"
chk "admin edit of the nickname records a correction" "$(apost "{\"action\":\"edit\",\"id\":\"$IID\",\"fields\":{\"nickname\":\"Testeur\"}}" | j "'id' in d['register']")" "True"
chk "the nickname is public" "$(curl -s "$H" | j "[i['nickname'] for i in d['items'] if i['id']=='$IID'][0]")" "Testeur"
chk "status change to 'parti' is recorded" "$(apost "{\"action\":\"status\",\"id\":\"$IID\",\"status\":\"parti\"}" | j "'id' in d['register']")" "True"
chk "honeypot looks accepted" "$(post '{"action":"propose","website":"http://spam","item":{"title":"spam"}}' | j "d['ok']")" "True"
apost "{\"action\":\"remove\",\"id\":\"$IID\",\"reason\":\"verify cleanup\"}" >/dev/null
echo "   [$PASS passed, $FAIL failed]"; [ "$FAIL" -eq 0 ]
