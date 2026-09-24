#!/bin/bash
# test-deployment.sh: checks that every deployed site answers on its 4xxx port.
#
# Where: a machine that runs `yarn prod:docker`, usually your own computer.
# When:  before you ask for a release, after `yarn prod:docker` has started.
# Why:   the Cloudflare tunnel sends each hostname to a localhost port. A site
#        that does not answer here returns an error to the public.
#
# Usage: scripts/test-deployment.sh

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_header() {
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}$1${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

print_success() {
  echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
  echo -e "${RED}✗ $1${NC}"
}

print_warning() {
  echo -e "${YELLOW}⚠ $1${NC}"
}

wait_for_service() {
  local url=$1
  local name=$2
  local max_attempts=30
  local attempt=0

  echo -n "Waiting for $name... "
  while [ $attempt -lt $max_attempts ]; do
    if curl -s -o /dev/null -w "%{http_code}" "$url" | grep -q "200\|404\|301\|302"; then
      print_success "$name is ready"
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 1
  done

  print_error "$name failed to start after ${max_attempts}s"
  return 1
}

test_endpoint() {
  local url=$1
  local name=$2
  local expected_status=${3:-200}

  local status=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo "000")

  if [ "$status" = "$expected_status" ]; then
    print_success "$name → $status"
    return 0
  else
    print_error "$name → $status (expected $expected_status)"
    return 1
  fi
}

test_cloudflared() {
  print_header "Testing Cloudflared Setup (Port Range: 4xxx)"

  local failed=0

  # Test seanmizen.com (Frontend only)
  echo -e "\n${YELLOW}seanmizen.com${NC}"
  test_endpoint "http://localhost:4000" "Frontend" || ((failed++))

  # Test carolinemizen.art (FE + BE)
  echo -e "\n${YELLOW}carolinemizen.art${NC}"
  test_endpoint "http://localhost:4020" "Frontend" || ((failed++))
  test_endpoint "http://localhost:4021" "Backend API" || ((failed++))

  # Test planning-poker (FE + BE)
  echo -e "\n${YELLOW}pp.seanmizen.com (planning-poker)${NC}"
  test_endpoint "http://localhost:4030" "Frontend" || ((failed++))
  test_endpoint "http://localhost:4031" "Backend API" || ((failed++))

  echo -e "\n${YELLOW}inside.seanmizen.com${NC}"
  test_endpoint "http://localhost:4060" "Frontend" || ((failed++))
  test_endpoint "http://localhost:4061/api/health" "Backend API" || ((failed++))

  echo -e "\n${YELLOW}seansconverter.com${NC}"
  test_endpoint "http://localhost:4050" "Frontend" || ((failed++))
  test_endpoint "http://localhost:4051/api/health" "Backend API" || ((failed++))

  echo ""
  if [ $failed -eq 0 ]; then
    print_success "All Cloudflared services passed!"
    return 0
  else
    print_error "$failed Cloudflared service(s) failed"
    return 1
  fi
}

main() {
  print_header "Deployment Smoke Test"
  echo ""

  local total_failed=0

  test_cloudflared || ((total_failed++))
  echo ""

  print_header "Test Summary"
  if [ $total_failed -eq 0 ]; then
    print_success "All tests passed! ✨"
    exit 0
  else
    print_error "Some tests failed. Check the output above for details."
    exit 1
  fi
}

main
