#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Cria os usuários de teste no Auth Service e os promove às roles corretas.
# Precisa do Python com boto3 disponível no container auth-backend.
#
# Uso:
#   bash scripts/seed-test-users.sh
#   AUTH_SERVICE_URL=http://localhost:8080 bash scripts/seed-test-users.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

AUTH="${AUTH_SERVICE_URL:-http://localhost:8080}"

GREEN='\033[32m'; RED='\033[31m'; YELLOW='\033[33m'; RESET='\033[0m'; BOLD='\033[1m'

register() {
  local email="$1" username="$2" first="$3" last="$4"
  RESULT=$(curl -s -X POST "$AUTH/users/register" \
    -H "Content-Type: application/json" \
    -d "{\"first_name\":\"$first\",\"last_name\":\"$last\",\"username\":\"$username\",\"email\":\"$email\",\"password\":\"Test1234!\"}")
  ID=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null)
  if [ -z "$ID" ]; then
    DETAIL=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('detail','?'))" 2>/dev/null)
    printf "  ${YELLOW}~${RESET}  %-40s  (já existe ou erro: %s)\n" "$username" "$DETAIL"
  else
    printf "  ${GREEN}✓${RESET}  %-40s  id=%s\n" "$username" "$ID"
  fi
}

promote() {
  local username="$1" role="$2"
  docker exec auth-backend python3 -c "
import boto3
ddb = boto3.client('dynamodb', region_name='us-east-1', endpoint_url='http://infra:4566',
    aws_access_key_id='test', aws_secret_access_key='test')
resp = ddb.scan(TableName='user',
    FilterExpression='username = :u',
    ExpressionAttributeValues={':u': {'S': '$username'}})
items = resp.get('Items', [])
if not items:
    print('User $username not found')
    exit(1)
user_id = items[0]['id']['S']
ddb.update_item(TableName='user',
    Key={'id': {'S': user_id}},
    UpdateExpression='SET access_level = :r',
    ExpressionAttributeValues={':r': {'S': '$role'}})
print('$username -> $role (' + user_id + ')')
" 2>&1
}

echo ""
printf "${BOLD}═══════════════════════════════════════════════════════${RESET}\n"
printf "${BOLD}  Seed usuários de teste — Auth Service: $AUTH${RESET}\n"
printf "${BOLD}═══════════════════════════════════════════════════════${RESET}\n"

echo ""
echo "Registrando usuários..."
register "checkin.participant@test.dev" "checkin_participant" "Check" "Participant"
register "checkin.manager@test.dev"     "checkin_manager"     "Check" "Manager"
register "checkin.admin@test.dev"       "checkin_admin"       "Check" "Admin"

echo ""
echo "Promovendo roles via DynamoDB..."
promote "checkin_manager" "MANAGER"
promote "checkin_admin"   "ADMIN"

echo ""
echo "Verificando tokens..."
for email in "checkin.participant@test.dev" "checkin.manager@test.dev" "checkin.admin@test.dev"; do
  TOK=$(curl -s -X POST "$AUTH/auth/login" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "username=$email&password=Test1234!" \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token','ERROR'))")
  SCOPES=$(echo "$TOK" | python3 -c "
import sys,base64,json
p=sys.stdin.read().strip().split('.')
if len(p)<2: print('ERROR'); exit()
payload=p[1]; payload+='='*(4-len(payload)%4)
d=json.loads(base64.urlsafe_b64decode(payload))
print(d.get('scopes','?'))
" 2>/dev/null)
  printf "  ${GREEN}✓${RESET}  %-40s  scopes=%s\n" "$email" "$SCOPES"
done

echo ""
printf "${GREEN}${BOLD}Usuários de teste prontos.${RESET}\n"
printf "Senha de todos: ${BOLD}Test1234!${RESET}\n\n"
