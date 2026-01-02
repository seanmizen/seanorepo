#!/bin/bash

# Test script for carolinemizen.art backend
# Tests all implemented endpoints without requiring email credentials

# Note: Don't exit on error - we want to see all test results

BASE_URL="http://localhost:4021"
BLUE='\033[0;34m'
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}======================================${NC}"
echo -e "${BLUE}carolinemizen.art Backend Test Suite${NC}"
echo -e "${BLUE}======================================${NC}\n"

# Test counter
TESTS_PASSED=0
TESTS_FAILED=0

test_endpoint() {
  local name="$1"
  local method="$2"
  local endpoint="$3"
  local data="$4"
  local expected_status="${5:-200}"

  echo -e "${YELLOW}Testing:${NC} $name"

  if [ -z "$data" ]; then
    response=$(curl -s -w "\n%{http_code}" -X "$method" "$BASE_URL$endpoint")
  else
    response=$(curl -s -w "\n%{http_code}" -X "$method" "$BASE_URL$endpoint" \
      -H "Content-Type: application/json" \
      -d "$data")
  fi

  body=$(echo "$response" | sed '$d')
  status=$(echo "$response" | tail -n 1)

  if [ "$status" = "$expected_status" ]; then
    echo -e "${GREEN}✓ PASS${NC} (HTTP $status)"
    echo "Response: $body" | head -c 200
    echo ""
    echo ""
    ((TESTS_PASSED++))
  else
    echo -e "${RED}✗ FAIL${NC} (Expected HTTP $expected_status, got $status)"
    echo "Response: $body"
    echo ""
    ((TESTS_FAILED++))
  fi
}

test_file_upload() {
  local name="$1"
  local file_path="$2"

  echo -e "${YELLOW}Testing:${NC} $name"

  # Create a test image if it doesn't exist
  if [ ! -f "$file_path" ]; then
    echo "Creating test image..."
    # Create a simple 100x100 red PNG
    cat > "$file_path" << 'EOF'
iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==
EOF
    base64 -d "$file_path" > "${file_path}.decoded"
    mv "${file_path}.decoded" "$file_path"
  fi

  response=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/admin/images/upload" \
    -F "file=@$file_path")

  body=$(echo "$response" | sed '$d')
  status=$(echo "$response" | tail -n 1)

  if [ "$status" = "200" ]; then
    echo -e "${GREEN}✓ PASS${NC} (HTTP $status)"
    echo "Response: $body" | head -c 200
    echo ""
    echo ""
    ((TESTS_PASSED++))
    # Extract image ID for later tests
    IMAGE_ID=$(echo "$body" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)
  else
    echo -e "${RED}✗ FAIL${NC} (Expected HTTP 200, got $status)"
    echo "Response: $body"
    echo ""
    ((TESTS_FAILED++))
  fi
}

echo -e "${BLUE}1. Health Check${NC}"
test_endpoint "Server health" "GET" "/"

echo -e "${BLUE}2. Database Operations${NC}"
test_endpoint "Reset database" "POST" "/db/reset"
test_endpoint "Test database connection" "GET" "/db/test"
test_endpoint "Execute query (get users)" "POST" "/db" 'SELECT * FROM users'
test_endpoint "Execute query (get site content)" "POST" "/db" 'SELECT * FROM site_content'

echo -e "${BLUE}3. Authentication Endpoints${NC}"
echo -e "${YELLOW}Note:${NC} Magic link will fail without SMTP credentials (expected)"
test_endpoint "Request magic link (will fail - no SMTP)" "POST" "/auth/magic-link" '{"email": "test@example.com"}' "500"
test_endpoint "Verify token (invalid token)" "GET" "/auth/verify?token=invalid" "401"
test_endpoint "Get current user (not authenticated)" "GET" "/auth/me" "401"

echo -e "${BLUE}4. Manual Token Test${NC}"
echo -e "${YELLOW}Creating magic token directly in database for testing...${NC}"

# Insert test user and token directly into database
TOKEN="test-token-$(date +%s)"
EXPIRES_AT=$(date -u -v+15M +"%Y-%m-%d %H:%M:%S" 2>/dev/null || date -u -d "+15 minutes" +"%Y-%m-%d %H:%M:%S")

# Create test user
curl -s -X POST "$BASE_URL/db" \
  -H "Content-Type: application/json" \
  -d "{\"query\": \"INSERT INTO users (email, role) VALUES ('testuser@example.com', 'admin')\"}" > /dev/null

# Get user ID
USER_ID=$(curl -s -X POST "$BASE_URL/db" \
  -H "Content-Type: application/json" \
  -d '{"query": "SELECT id FROM users WHERE email = '\''testuser@example.com'\''"}' | grep -o '"id":[0-9]*' | cut -d: -f2)

# Create magic token
curl -s -X POST "$BASE_URL/db" \
  -H "Content-Type: application/json" \
  -d "{\"query\": \"INSERT INTO magic_tokens (user_id, token, expires_at) VALUES ($USER_ID, '$TOKEN', '$EXPIRES_AT')\"}" > /dev/null

test_endpoint "Verify valid magic token" "GET" "/auth/verify?token=$TOKEN"

# Extract JWT from response for authenticated requests
echo -e "${YELLOW}Getting JWT token from verify response...${NC}"
VERIFY_RESPONSE=$(curl -s -c /tmp/cookies.txt "http://localhost:4021/auth/verify?token=$TOKEN")
echo "Verify response: $VERIFY_RESPONSE"

test_endpoint "Get current user (authenticated)" "GET" "/auth/me"
test_endpoint "Logout" "POST" "/auth/logout"

echo -e "${BLUE}5. Image Upload Endpoints${NC}"

# Create a test image
TEST_IMAGE="/tmp/test-image-$$.png"
# Create a 1x1 red pixel PNG (base64 decoded)
printf '\x89\x50\x4e\x47\x0d\x0a\x1a\x0a\x00\x00\x00\x0d\x49\x48\x44\x52\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90\x77\x53\xde\x00\x00\x00\x0c\x49\x44\x41\x54\x08\xd7\x63\xf8\xcf\xc0\x00\x00\x03\x01\x01\x00\x18\xdd\x8d\xb4\x00\x00\x00\x00\x49\x45\x4e\x44\xae\x42\x60\x82' > "$TEST_IMAGE"

test_file_upload "Upload image" "$TEST_IMAGE"

if [ -n "$IMAGE_ID" ]; then
  test_endpoint "List images" "GET" "/admin/images?page=1&limit=10"
  test_endpoint "Delete image" "DELETE" "/admin/images/$IMAGE_ID"
fi

# Cleanup
rm -f "$TEST_IMAGE" /tmp/cookies.txt

echo -e "\n${BLUE}======================================${NC}"
echo -e "${BLUE}Test Summary${NC}"
echo -e "${BLUE}======================================${NC}"
echo -e "${GREEN}Passed: $TESTS_PASSED${NC}"
echo -e "${RED}Failed: $TESTS_FAILED${NC}"

if [ $TESTS_FAILED -eq 0 ]; then
  echo -e "\n${GREEN}All tests passed!${NC}"
  exit 0
else
  echo -e "\n${RED}Some tests failed.${NC}"
  exit 1
fi
