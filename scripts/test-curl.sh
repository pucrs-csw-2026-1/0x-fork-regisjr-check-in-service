#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Bateria de testes via curl para o check-in service.
# Usa tokens reais emitidos pelo Auth Service (RS256/JWKS).
#
# Pré-requisitos:
#   - Auth Service rodando em AUTH_SERVICE_URL (padrão: http://localhost:8080)
#   - Check-in Service rodando em CHECK_IN_URL (padrão: http://localhost:3333)
#   - Usuários de teste registrados (crie com scripts/seed-test-users.sh)
#
# Uso:
#   bash scripts/test-curl.sh
#   AUTH_SERVICE_URL=http://localhost:8080 CHECK_IN_URL=http://localhost:3000 bash scripts/test-curl.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

AUTH="${AUTH_SERVICE_URL:-http://localhost:8080}"
BASE="${CHECK_IN_URL:-http://localhost:3333}"
QR_SECRET="${QR_JWT_SECRET:-dev-qr-secret-change-in-production}"

GREEN='\033[32m'; RED='\033[31m'; CYAN='\033[36m'; RESET='\033[0m'; BOLD='\033[1m'

PASS=0; FAIL=0

req() {
  local label="$1" exp="$2"; shift 2
  local code body
  code=$(curl -s -o /tmp/_cb -w "%{http_code}" "$@")
  body=$(cat /tmp/_cb)
  if [ "$code" = "$exp" ]; then
    printf "  ${GREEN}✓${RESET}  %-60s [%s]\n" "$label" "$code"
    PASS=$((PASS+1))
  else
    printf "  ${RED}✗${RESET}  %-60s [got:%s exp:%s]  %s\n" "$label" "$code" "$exp" "$(echo "$body" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("detail","?"))' 2>/dev/null || echo "$body")"
    FAIL=$((FAIL+1))
  fi
}

section() { printf "\n${BOLD}${CYAN}▸ %s${RESET}\n" "$1"; }

# ─── Obter tokens do Auth Service ────────────────────────────────────────────
get_token() {
  curl -s -X POST "$AUTH/auth/login" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "username=$1&password=$2" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('access_token','ERROR:'+str(d.get('detail',''))))"
}

get_sub() {
  echo "$1" | python3 -c "
import sys,base64,json
p=sys.stdin.read().strip().split('.')
if len(p)<2: print(''); exit()
payload=p[1]; payload+='='*(4-len(payload)%4)
print(json.loads(base64.urlsafe_b64decode(payload)).get('sub',''))
"
}

make_qr_token() {
  # eventId userId — gera QR JWT com o segredo local usando Node.js
  node -e "
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const token = jwt.sign(
  { eventId: process.argv[1], userId: process.argv[2], jti: crypto.randomUUID() },
  process.env.QR_JWT_SECRET || '${QR_SECRET}',
  { algorithm: 'HS256', expiresIn: 300 }
);
process.stdout.write(token);
" "$1" "$2" 2>/dev/null || echo ""
}

echo ""
printf "${BOLD}══════════════════════════════════════════════════════════════════════${RESET}\n"
printf "${BOLD}  CHECK-IN SERVICE — Bateria de testes curl (Auth Service: $AUTH)${RESET}\n"
printf "${BOLD}══════════════════════════════════════════════════════════════════════${RESET}\n"

# Verificar que os serviços estão de pé
section "Verificação de saúde"
req "Auth Service GET /health"   200 "$AUTH/health"
req "Check-in GET /health"       200 "$BASE/health"

# Buscar tokens
section "Obtendo tokens do Auth Service"
PART_TOK=$(get_token "checkin.participant@test.dev" "Test1234!")
MGMT_TOK=$(get_token "checkin.manager@test.dev"     "Test1234!")
ADMT_TOK=$(get_token "checkin.admin@test.dev"       "Test1234!")

if echo "$PART_TOK" | grep -q "^ERROR"; then
  echo "  ${RED}✗ Falha ao obter token participant: $PART_TOK${RESET}"
  echo "    Execute: bash scripts/seed-test-users.sh"
  exit 1
fi

PART_ID=$(get_sub "$PART_TOK")
MGMT_ID=$(get_sub "$MGMT_TOK")
ADMT_ID=$(get_sub "$ADMT_TOK")

printf "  participant  sub=%s\n" "$PART_ID"
printf "  manager      sub=%s\n" "$MGMT_ID"
printf "  admin        sub=%s\n" "$ADMT_ID"

# QR tokens para testes de scan
QR_VALID=$(make_qr_token "evt-test" "$PART_ID")
REFRESH_TOK=$(curl -s -X POST "$AUTH/auth/login" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=checkin.participant@test.dev&password=Test1234!" \
  | python3 -c "import sys,json; print(json.load(sys.stdin).get('refresh_token',''))")

# ─────────────────────────────────────────────────────────────────────────────
section "AUTH ERRORS — 401"
req "sem Authorization"          401 "$BASE/events/e/guests/u/qr-code"
req "sem prefixo Bearer"         401 -H "Authorization: $PART_TOK" "$BASE/events/e/guests/u/qr-code"
req "JWT malformado"             401 -H "Authorization: Bearer not.a.valid.jwt" "$BASE/events/e/guests/u/qr-code"
req "refresh_token (não access)" 401 -H "Authorization: Bearer $REFRESH_TOK" "$BASE/events/e/guests/u/qr-code"

# ─────────────────────────────────────────────────────────────────────────────
section "SCOPE ERRORS — 403 (token RS256 válido, role insuficiente)"
req "participant escaneia (requer manager)"         403 \
  -H "Authorization: Bearer $PART_TOK" -X POST \
  -H "Content-Type: application/json" \
  -d '{"token":"t","eventId":"e","scannedBy":"u"}' "$BASE/check-ins/scan"

req "participant lista check-ins (requer manager)"  403 \
  -H "Authorization: Bearer $PART_TOK" "$BASE/events/e/check-ins"

req "participant vê stats (requer manager)"         403 \
  -H "Authorization: Bearer $PART_TOK" "$BASE/events/e/check-ins/stats"

req "participant faz manual (requer manager)"       403 \
  -H "Authorization: Bearer $PART_TOK" -X POST \
  -H "Content-Type: application/json" \
  -d '{"userId":"u","performedBy":"u"}' "$BASE/events/e/check-ins/manual"

req "participant gera QR de outro user (self-check)" 403 \
  -H "Authorization: Bearer $PART_TOK" "$BASE/events/e/guests/outro-user-id/qr-code"

# ─────────────────────────────────────────────────────────────────────────────
section "AUTORIZAÇÃO CORRETA — scopes cumulativos"
req "participant gera próprio QR → 503 (Reg.Svc down)"     503 \
  -H "Authorization: Bearer $PART_TOK" \
  "$BASE/events/evt-test/guests/$PART_ID/qr-code"

req "manager escaneia com QR inválido → 401"               401 \
  -H "Authorization: Bearer $MGMT_TOK" -X POST \
  -H "Content-Type: application/json" \
  -d "{\"token\":\"invalido\",\"eventId\":\"evt-test\",\"scannedBy\":\"$MGMT_ID\"}" \
  "$BASE/check-ins/scan"

req "manager escaneia QR válido → 503 (Reg.Svc down)"      503 \
  -H "Authorization: Bearer $MGMT_TOK" -X POST \
  -H "Content-Type: application/json" \
  -d "{\"token\":\"$QR_VALID\",\"eventId\":\"evt-test\",\"scannedBy\":\"$MGMT_ID\"}" \
  "$BASE/check-ins/scan"

req "manager lista check-ins → 503 (DynamoDB down)"        503 \
  -H "Authorization: Bearer $MGMT_TOK" \
  "$BASE/events/evt-test/check-ins"

req "manager vê stats → 503 (DynamoDB down)"               503 \
  -H "Authorization: Bearer $MGMT_TOK" \
  "$BASE/events/evt-test/check-ins/stats"

req "manager faz manual → 503 (Reg.Svc down)"              503 \
  -H "Authorization: Bearer $MGMT_TOK" -X POST \
  -H "Content-Type: application/json" \
  -d "{\"userId\":\"$PART_ID\",\"performedBy\":\"$MGMT_ID\"}" \
  "$BASE/events/evt-test/check-ins/manual"

req "admin gera QR para qualquer user → 503"               503 \
  -H "Authorization: Bearer $ADMT_TOK" \
  "$BASE/events/evt-test/guests/$PART_ID/qr-code"

req "admin lista check-ins → 503"                          503 \
  -H "Authorization: Bearer $ADMT_TOK" \
  "$BASE/events/evt-test/check-ins"

req "admin vê stats → 503"                                  503 \
  -H "Authorization: Bearer $ADMT_TOK" \
  "$BASE/events/evt-test/check-ins/stats"

req "participant vê próprio check-in → 503 (DynamoDB)"     503 \
  -H "Authorization: Bearer $PART_TOK" \
  "$BASE/events/evt-test/check-ins/$PART_ID"

req "manager vê check-in de outro → 503 (DynamoDB)"        503 \
  -H "Authorization: Bearer $MGMT_TOK" \
  "$BASE/events/evt-test/check-ins/$PART_ID"

# ─────────────────────────────────────────────────────────────────────────────
section "VALIDAÇÃO DTO — 400"
req "scan sem token"         400 \
  -H "Authorization: Bearer $MGMT_TOK" -X POST \
  -H "Content-Type: application/json" \
  -d "{\"eventId\":\"e\",\"scannedBy\":\"$MGMT_ID\"}" "$BASE/check-ins/scan"

req "scan sem eventId"       400 \
  -H "Authorization: Bearer $MGMT_TOK" -X POST \
  -H "Content-Type: application/json" \
  -d "{\"token\":\"t\",\"scannedBy\":\"$MGMT_ID\"}" "$BASE/check-ins/scan"

req "scan body vazio"        400 \
  -H "Authorization: Bearer $MGMT_TOK" -X POST \
  -H "Content-Type: application/json" \
  -d '{}' "$BASE/check-ins/scan"

req "scan token como número" 400 \
  -H "Authorization: Bearer $MGMT_TOK" -X POST \
  -H "Content-Type: application/json" \
  -d '{"token":99,"eventId":"e","scannedBy":"s"}' "$BASE/check-ins/scan"

req "manual sem userId"      400 \
  -H "Authorization: Bearer $MGMT_TOK" -X POST \
  -H "Content-Type: application/json" \
  -d '{"performedBy":"s"}' "$BASE/events/e/check-ins/manual"

req "manual sem performedBy" 400 \
  -H "Authorization: Bearer $MGMT_TOK" -X POST \
  -H "Content-Type: application/json" \
  -d '{"userId":"u"}' "$BASE/events/e/check-ins/manual"

# ─────────────────────────────────────────────────────────────────────────────
section "ROTAS INVÁLIDAS"
req "GET rota inexistente → 404"  404 -H "Authorization: Bearer $ADMT_TOK" "$BASE/nao-existe"
req "POST em rota GET → 404"      404 -H "Authorization: Bearer $MGMT_TOK" -X POST "$BASE/events/e/check-ins/stats"

# ─────────────────────────────────────────────────────────────────────────────
section "FORMATO DA RESPOSTA (ADR-008)"

BODY=$(curl -s "$BASE/events/e/guests/u/qr-code")
if echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'detail' in d and 'message' not in d" 2>/dev/null; then
  printf "  ${GREEN}✓${RESET}  %-60s\n" "campo 'detail' presente, 'message' ausente"
  PASS=$((PASS+1))
else
  printf "  ${RED}✗${RESET}  %-60s  %s\n" "campo de erro incorreto" "$BODY"
  FAIL=$((FAIL+1))
fi

TRACE_VAL="curl-trace-$(date +%s)"
TRACE_HDR=$(curl -s -D - -H "x-trace-id: $TRACE_VAL" "$BASE/health" 2>&1 | grep -i "^x-trace-id")
if echo "$TRACE_HDR" | grep -q "$TRACE_VAL"; then
  printf "  ${GREEN}✓${RESET}  %-60s\n" "x-trace-id ecoado no response"
  PASS=$((PASS+1))
else
  printf "  ${RED}✗${RESET}  %-60s\n" "x-trace-id não ecoado"
  FAIL=$((FAIL+1))
fi

# ─────────────────────────────────────────────────────────────────────────────
echo ""
printf "${BOLD}══════════════════════════════════════════════════════════════════════${RESET}\n"
if [ "$FAIL" -eq 0 ]; then
  printf "  ${GREEN}${BOLD}✓ Todos os testes passaram: %d/%d${RESET}\n" "$PASS" "$((PASS+FAIL))"
else
  printf "  ${RED}${BOLD}✗ Falhas: %d | Passou: %d | Total: %d${RESET}\n" "$FAIL" "$PASS" "$((PASS+FAIL))"
fi
printf "${BOLD}══════════════════════════════════════════════════════════════════════${RESET}\n"
echo ""

[ "$FAIL" -eq 0 ] && exit 0 || exit 1
