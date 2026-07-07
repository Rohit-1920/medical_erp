#!/bin/bash

# ─────────────────────────────────────────────────────────────────────────────
# MedERP Docker — Add Stock Script
# Run AFTER docker-seed.sh and after adding at least one product as distributor
# Usage: bash docker-add-stock.sh
#
# Why this is needed:
#   Creating a product adds it to the catalog only.
#   Without stock, order approval fails with "Insufficient stock".
#   This script adds 1000 units of stock to the FIRST product in the catalog.
# ─────────────────────────────────────────────────────────────────────────────

echo ""
echo "============================================"
echo "      MedERP Docker — Add Stock"
echo "============================================"

# All requests go through Nginx on port 80
# /api/user/  → user-service:8081/api/v1/
# /api/product/ → product-service:8082/api/v1/

echo ""
echo "🔑 Getting distributor token..."
TOKEN=$(curl -s -X POST http://localhost/api/user/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"distributor@mederr.com","password":"Dist@1234"}' | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")

if [ -z "$TOKEN" ]; then
  echo "❌ Failed to get token. Make sure:"
  echo "   1. docker compose is running"
  echo "   2. You have run docker-seed.sh first"
  exit 1
fi
echo "✅ Token obtained"

echo ""
echo "🔑 Getting distributor org ID..."
DIST_ORG_ID=$(curl -s -X POST http://localhost/api/user/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"distributor@mederr.com","password":"Dist@1234"}' | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['user']['organizationId'])")

echo "✅ Distributor Org ID: $DIST_ORG_ID"

echo ""
echo "📦 Getting product list..."
PRODUCTS=$(curl -s http://localhost/api/product/products \
  -H "Authorization: Bearer $TOKEN")

PRODUCT_COUNT=$(echo "$PRODUCTS" | python3 -c "
import sys,json
try:
  d = json.load(sys.stdin)
  print(d.get('totalElements', 0))
except:
  print(0)
" 2>/dev/null)

if [ "$PRODUCT_COUNT" = "0" ]; then
  echo ""
  echo "❌ No products found."
  echo "   Log in as DISTRIBUTOR → Products → + Add Product first"
  echo "   Then run this script again."
  exit 1
fi

echo "✅ Found $PRODUCT_COUNT product(s)"

# Add stock to ALL products that belong to this distributor
echo "$PRODUCTS" | python3 -c "
import sys, json
try:
  d = json.load(sys.stdin)
  for p in d.get('content', []):
    print(p['id'] + '|' + p['name'])
except:
  pass
" | while IFS='|' read -r PRODUCT_ID PRODUCT_NAME; do
  echo ""
  echo "📦 Adding stock for: $PRODUCT_NAME ($PRODUCT_ID)..."

  RESP=$(curl -s -X POST http://localhost/api/product/products/inventory \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d "{
      \"productId\": \"$PRODUCT_ID\",
      \"warehouseId\": \"WH-01\",
      \"warehouseLocation\": \"Main Warehouse\",
      \"batchNumber\": \"BATCH-$(date +%s)\",
      \"manufacturingDate\": \"2026-01-01\",
      \"expiryDate\": \"2028-01-01\",
      \"quantity\": 1000,
      \"reorderLevel\": 10,
      \"distributorId\": \"$DIST_ORG_ID\"
    }")

  STATUS=$(echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status',''))" 2>/dev/null)
  QTY=$(echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('quantityAvailable',''))" 2>/dev/null)

  if [ -n "$STATUS" ]; then
    echo "✅ Stock added: $QTY units, status: $STATUS"
  else
    echo "⚠️  Unexpected response: $RESP"
  fi
done

echo ""
echo "============================================"
echo "  ✅ Stock Added Successfully!"
echo "============================================"
echo ""
echo "  You can now:"
echo "  1. Log in as HOSPITAL → + New Order → place an order"
echo "  2. Log in as DISTRIBUTOR → Dashboard → Approve the order"
echo "============================================"
