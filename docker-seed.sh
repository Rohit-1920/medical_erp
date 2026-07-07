#!/bin/bash

set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# MedERP Docker Bootstrap Script
# Run AFTER: docker compose up --build -d
# Usage: bash docker-seed.sh
# Safe to run multiple times — skips existing orgs and users
# ─────────────────────────────────────────────────────────────────────────────

# All requests go through Nginx on port 80
# Nginx strips /api/user/ and proxies to user-service:8081/api/v1/
# So /api/user/auth/login → user-service:8081/api/v1/auth/login
API_BASE="http://localhost/api/user"
HEALTH_URL="http://localhost/api/user/actuator/health"
TIMESTAMP=$(date +%s)

echo ""
echo "============================================"
echo "      MedERP Docker Bootstrap Script"
echo "============================================"

# ── Wait for user-service to be healthy ──────────────────────────────────────
echo ""
echo "⏳ Waiting for user-service to be ready..."

MAX_WAIT=120
COUNT=0

until curl -fs "$HEALTH_URL" > /dev/null 2>&1; do
  sleep 3
  COUNT=$((COUNT + 3))
  echo "   still waiting... (${COUNT}s)"
  if [ "$COUNT" -ge "$MAX_WAIT" ]; then
    echo ""
    echo "❌ user-service did not become healthy in ${MAX_WAIT}s"
    echo ""
    echo "Container status:"
    docker compose ps
    echo ""
    echo "user-service logs:"
    docker compose logs --tail=50 user-service
    exit 1
  fi
done

echo "✅ user-service is ready"

# ── Helper: GET request ───────────────────────────────────────────────────────
get_request() {
  local URL=$1
  local TOKEN=${2:-}
  if [ -n "$TOKEN" ]; then
    curl -s -H "Authorization: Bearer $TOKEN" "$URL"
  else
    curl -s "$URL"
  fi
}

# ── Helper: POST request ──────────────────────────────────────────────────────
post_request() {
  local URL=$1
  local BODY=$2
  local TOKEN=${3:-}
  if [ -n "$TOKEN" ]; then
    curl -s -X POST \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" \
      -d "$BODY" \
      "$URL"
  else
    curl -s -X POST \
      -H "Content-Type: application/json" \
      -d "$BODY" \
      "$URL"
  fi
}

# ── Helper: get org ID by type ────────────────────────────────────────────────
get_org_id_by_type() {
  local TYPE=$1
  get_request "$API_BASE/organizations" | python3 -c "
import sys, json
try:
  orgs = json.load(sys.stdin)
  for o in orgs:
    if o.get('type') == '$TYPE' and o.get('active', True):
      print(o['id'])
      break
except:
  pass
" 2>/dev/null
}

# ── Create or reuse Hospital org ──────────────────────────────────────────────
echo ""
echo "📦 Setting up Hospital Organization..."
HOSPITAL_ID=$(get_org_id_by_type "HOSPITAL")

if [ -z "$HOSPITAL_ID" ]; then
  RESP=$(post_request "$API_BASE/organizations" "{
    \"name\": \"City General Hospital\",
    \"registrationNumber\": \"HOSP-$TIMESTAMP\",
    \"type\": \"HOSPITAL\",
    \"address\": {
      \"street\": \"123 Main St\",
      \"city\": \"Mumbai\",
      \"state\": \"MH\",
      \"pincode\": \"400001\",
      \"country\": \"India\"
    },
    \"contactEmail\": \"hospital@mederr.com\",
    \"contactPhone\": \"+91-9876543210\",
    \"active\": true
  }")
  HOSPITAL_ID=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
  echo "✅ Hospital org created: $HOSPITAL_ID"
else
  echo "✅ Hospital org already exists: $HOSPITAL_ID (reusing)"
fi

if [ -z "$HOSPITAL_ID" ]; then
  echo "❌ Failed to get Hospital org ID. Exiting."
  exit 1
fi

# ── Create or reuse Distributor org ──────────────────────────────────────────
echo ""
echo "📦 Setting up Distributor Organization..."
DISTRIBUTOR_ID=$(get_org_id_by_type "DISTRIBUTOR")

if [ -z "$DISTRIBUTOR_ID" ]; then
  RESP=$(post_request "$API_BASE/organizations" "{
    \"name\": \"ABC Distributors Pvt Ltd\",
    \"registrationNumber\": \"DIST-$TIMESTAMP\",
    \"type\": \"DISTRIBUTOR\",
    \"address\": {
      \"street\": \"456 Market Rd\",
      \"city\": \"Pune\",
      \"state\": \"MH\",
      \"pincode\": \"411001\",
      \"country\": \"India\"
    },
    \"contactEmail\": \"distributor@mederr.com\",
    \"contactPhone\": \"+91-9876543211\",
    \"active\": true
  }")
  DISTRIBUTOR_ID=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
  echo "✅ Distributor org created: $DISTRIBUTOR_ID"
else
  echo "✅ Distributor org already exists: $DISTRIBUTOR_ID (reusing)"
fi

if [ -z "$DISTRIBUTOR_ID" ]; then
  echo "❌ Failed to get Distributor org ID. Exiting."
  exit 1
fi

# ── Helper: register user ─────────────────────────────────────────────────────
register_user() {
  local FIRST=$1 LAST=$2 EMAIL=$3 PASS=$4 ROLE=$5 ORG=$6
  RESP=$(post_request "$API_BASE/auth/register" "{
    \"firstName\": \"$FIRST\",
    \"lastName\": \"$LAST\",
    \"email\": \"$EMAIL\",
    \"password\": \"$PASS\",
    \"role\": \"$ROLE\",
    \"organizationId\": \"$ORG\"
  }")
  if echo "$RESP" | grep -q "accessToken"; then
    echo "✅ $ROLE user created: $EMAIL"
  elif echo "$RESP" | grep -q "already registered"; then
    echo "✅ $ROLE user already exists: $EMAIL (skipping)"
  else
    echo "⚠️  $ROLE user issue: $(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('detail','unknown'))" 2>/dev/null)"
  fi
}

echo ""
echo "👤 Setting up users..."
register_user "Admin"    "User"        "admin@mederr.com"       "Admin@1234"  "ADMIN"       "$HOSPITAL_ID"
register_user "Rohit"    "Distributor" "distributor@mederr.com" "Dist@1234"   "DISTRIBUTOR" "$DISTRIBUTOR_ID"
register_user "Hospital" "User"        "hospital@mederr.com"    "Hosp@1234"   "HOSPITAL"    "$HOSPITAL_ID"

echo ""
echo "============================================"
echo "  ✅ MedERP Bootstrap Complete!"
echo "============================================"
echo ""
EC2_IP=$(curl -s ifconfig.me 2>/dev/null || echo "<your-ec2-ip>")
echo "  Open: http://$EC2_IP"
echo ""
echo "  Login credentials:"
echo "  ┌─────────────┬──────────────────────────┬────────────┐"
echo "  │ Role        │ Email                    │ Password   │"
echo "  ├─────────────┼──────────────────────────┼────────────┤"
echo "  │ ADMIN       │ admin@mederr.com          │ Admin@1234 │"
echo "  │ DISTRIBUTOR │ distributor@mederr.com    │ Dist@1234  │"
echo "  │ HOSPITAL    │ hospital@mederr.com       │ Hosp@1234  │"
echo "  └─────────────┴──────────────────────────┴────────────┘"
echo ""
echo "  Next steps:"
echo "  1. Log in as DISTRIBUTOR → Add products via + Add Product"
echo "  2. Run: bash docker-add-stock.sh   (adds stock so orders can be approved)"
echo "  3. Log in as HOSPITAL    → Place an order via + New Order"
echo "  4. Log in as DISTRIBUTOR → Approve the order from Dashboard"
echo "============================================"
