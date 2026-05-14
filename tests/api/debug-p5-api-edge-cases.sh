#!/bin/bash
# debug-p5-api-edge-cases.sh
# Phase 5.2: API edge cases — malformed inputs, wrong methods, injection payloads
# Requires dev server running on PORT (default 3000)

PORT=${1:-3000}
BASE="http://localhost:$PORT"
PASS=0
FAIL=0

check() {
  local desc="$1"
  local expected_status="$2"
  local actual_status="$3"
  local body="$4"
  if [ "$actual_status" = "$expected_status" ]; then
    echo "  PASS: $desc (HTTP $actual_status)"
    PASS=$((PASS+1))
  else
    echo "  FAIL: $desc — expected HTTP $expected_status, got HTTP $actual_status | body: $body"
    FAIL=$((FAIL+1))
  fi
}

echo "=== Phase 5.2: API Edge Cases ==="
echo ""

echo "--- GET /api/health ---"
r=$(curl -s -o /tmp/api_body.txt -w "%{http_code}" "$BASE/api/health")
check "GET /api/health → 200" "200" "$r" "$(cat /tmp/api_body.txt)"

echo ""
echo "--- POST /api/scan/behavioral: valid cases ---"
r=$(curl -s -o /tmp/api_body.txt -w "%{http_code}" -X POST "$BASE/api/scan/behavioral" \
  -H "Content-Type: application/json" \
  -d '{"agentAddress":"0x5F6a3AbC97E421f7B3930fc504D6a0CE4eE41e06"}')
check "Valid address → 200" "200" "$r" "$(cat /tmp/api_body.txt)"

echo ""
echo "--- POST /api/scan/behavioral: invalid address cases ---"
r=$(curl -s -o /tmp/api_body.txt -w "%{http_code}" -X POST "$BASE/api/scan/behavioral" \
  -H "Content-Type: application/json" \
  -d '{"agentAddress":"not-an-address"}')
check "Non-hex address → 400" "400" "$r" "$(cat /tmp/api_body.txt)"

r=$(curl -s -o /tmp/api_body.txt -w "%{http_code}" -X POST "$BASE/api/scan/behavioral" \
  -H "Content-Type: application/json" \
  -d '{"agentAddress":"0x123"}')
check "Too-short address → 400" "400" "$r" "$(cat /tmp/api_body.txt)"

r=$(curl -s -o /tmp/api_body.txt -w "%{http_code}" -X POST "$BASE/api/scan/behavioral" \
  -H "Content-Type: application/json" \
  -d '{}')
check "Missing agentAddress → 400" "400" "$r" "$(cat /tmp/api_body.txt)"

r=$(curl -s -o /tmp/api_body.txt -w "%{http_code}" -X POST "$BASE/api/scan/behavioral" \
  -H "Content-Type: application/json" \
  -d '{"agentAddress":null}')
check "Null agentAddress → 400" "400" "$r" "$(cat /tmp/api_body.txt)"

r=$(curl -s -o /tmp/api_body.txt -w "%{http_code}" -X POST "$BASE/api/scan/behavioral" \
  -H "Content-Type: application/json" \
  -d '{"agentAddress":""}')
check "Empty string agentAddress → 400" "400" "$r" "$(cat /tmp/api_body.txt)"

echo ""
echo "--- POST /api/scan/behavioral: SQL injection / XSS payloads ---"
r=$(curl -s -o /tmp/api_body.txt -w "%{http_code}" -X POST "$BASE/api/scan/behavioral" \
  -H "Content-Type: application/json" \
  -d '{"agentAddress":"0x\u0027 OR 1=1--"}')
check "SQL injection in address → 400 (regex rejects)" "400" "$r" "$(cat /tmp/api_body.txt)"

r=$(curl -s -o /tmp/api_body.txt -w "%{http_code}" -X POST "$BASE/api/scan/behavioral" \
  -H "Content-Type: application/json" \
  -d '{"agentAddress":"<script>alert(1)</script>"}')
check "XSS payload in address → 400 (regex rejects)" "400" "$r" "$(cat /tmp/api_body.txt)"

echo ""
echo "--- POST /api/scan/behavioral: malformed JSON ---"
r=$(curl -s -o /tmp/api_body.txt -w "%{http_code}" -X POST "$BASE/api/scan/behavioral" \
  -H "Content-Type: application/json" \
  -d 'not json {')
check "Malformed JSON → 400 or 500" "400" "$r" "$(cat /tmp/api_body.txt)" 2>/dev/null || \
check "Malformed JSON → 400 or 500" "500" "$r" "$(cat /tmp/api_body.txt)"

echo ""
echo "--- Wrong HTTP methods ---"
r=$(curl -s -o /tmp/api_body.txt -w "%{http_code}" -X GET "$BASE/api/scan/behavioral")
check "GET /api/scan/behavioral → 405" "405" "$r" "$(cat /tmp/api_body.txt)"

r=$(curl -s -o /tmp/api_body.txt -w "%{http_code}" -X GET "$BASE/api/scan/code")
check "GET /api/scan/code → 405" "405" "$r" "$(cat /tmp/api_body.txt)"

r=$(curl -s -o /tmp/api_body.txt -w "%{http_code}" -X POST "$BASE/api/health")
check "POST /api/health → 405" "405" "$r" "$(cat /tmp/api_body.txt)"

echo ""
echo "--- POST /api/scan/code: edge cases ---"
r=$(curl -s -o /tmp/api_body.txt -w "%{http_code}" -X POST "$BASE/api/scan/code" \
  -H "Content-Type: application/json" \
  -d '{"agentAddress":"0x5F6a3AbC97E421f7B3930fc504D6a0CE4eE41e06"}')
check "Code scan no contractSource → 200 (fallback WARNING)" "200" "$r" "$(cat /tmp/api_body.txt)"

r=$(curl -s -o /tmp/api_body.txt -w "%{http_code}" -X POST "$BASE/api/scan/code" \
  -H "Content-Type: application/json" \
  -d '{}')
check "Code scan missing agentAddress → 400" "400" "$r" "$(cat /tmp/api_body.txt)"

r=$(curl -s -o /tmp/api_body.txt -w "%{http_code}" -X POST "$BASE/api/scan/code" \
  -H "Content-Type: application/json" \
  -d '{"agentAddress":"0x5F6a3AbC97E421f7B3930fc504D6a0CE4eE41e06","contractSource":""}')
check "Code scan empty contractSource → 200 (WARNING guard triggers)" "200" "$r" "$(cat /tmp/api_body.txt)"

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
if [ "$FAIL" -eq 0 ]; then
  echo "PHASE 5.2: PASS"
  exit 0
else
  echo "PHASE 5.2: FAIL"
  exit 1
fi
