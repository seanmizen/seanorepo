#!/bin/bash
# Deployment Smoke Test Script
# Tests all services for both Cloudflared (4xxx) and Fly.io (5xxx) setups
# Usage: ./test-deployment.sh [cloudflared|flyio|both]

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

MODE="${1:-both}"

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

  # Test seanscards.com (FE + BE)
  echo -e "\n${YELLOW}seanscards.com${NC}"
  test_endpoint "http://localhost:4010" "Frontend" || ((failed++))
  test_endpoint "http://localhost:4011/api" "Backend API" || ((failed++))

  # Test carolinemizen.art (FE + BE)
  echo -e "\n${YELLOW}carolinemizen.art${NC}"
  test_endpoint "http://localhost:4020" "Frontend" || ((failed++))
  test_endpoint "http://localhost:4021" "Backend API" || ((failed++))

  # Test planning-poker (FE + BE)
  echo -e "\n${YELLOW}pp.seanmizen.com (planning-poker)${NC}"
  test_endpoint "http://localhost:4040" "Frontend" || ((failed++))
  test_endpoint "http://localhost:4041" "Backend API" || ((failed++))

  echo ""
  if [ $failed -eq 0 ]; then
    print_success "All Cloudflared services passed!"
    return 0
  else
    print_error "$failed Cloudflared service(s) failed"
    return 1
  fi
}

test_flyio() {
  print_header "Testing Fly.io Setup (Port Range: 6xxx local → 5xxx container)"

  local failed=0

  # Test seanmizen.com (Frontend only)
  echo -e "\n${YELLOW}seanmizen.com${NC}"
  test_endpoint "http://localhost:6000" "Frontend" || ((failed++))

  # Test seanscards.com (FE + BE)
  echo -e "\n${YELLOW}seanscards.com${NC}"
  test_endpoint "http://localhost:6010" "Frontend" || ((failed++))
  test_endpoint "http://localhost:6011/api" "Backend API" || ((failed++))

  # Test carolinemizen.art (FE + BE)
  echo -e "\n${YELLOW}carolinemizen.art${NC}"
  test_endpoint "http://localhost:6020" "Frontend" || ((failed++))
  test_endpoint "http://localhost:6021" "Backend API" || ((failed++))

  # Test planning-poker (FE + BE)
  echo -e "\n${YELLOW}pp.seanmizen.com (planning-poker)${NC}"
  test_endpoint "http://localhost:6040" "Frontend" || ((failed++))
  test_endpoint "http://localhost:6041" "Backend API" || ((failed++))

  echo ""
  if [ $failed -eq 0 ]; then
    print_success "All Fly.io services passed!"
    return 0
  else
    print_error "$failed Fly.io service(s) failed"
    return 1
  fi
}

test_flyio_nginx() {
  print_header "Testing Fly.io Nginx Gateway (Port 8080)"

  local failed=0

  echo -e "\n${YELLOW}Testing nginx routing${NC}"

  # Test with localhost (should route to seanmizen.com)
  test_endpoint "http://localhost:8080" "localhost → seanmizen.com" || ((failed++))

  # Test with Host headers (simulating domain routing)
  echo -e "\nTesting domain-based routing (via Host header)..."

  local status=$(curl -s -o /dev/null -w "%{http_code}" -H "Host: seanscards.com" "http://localhost:8080" 2>/dev/null || echo "000")
  if [ "$status" = "200" ]; then
    print_success "seanscards.com routing → $status"
  else
    print_error "seanscards.com routing → $status"
    ((failed++))
  fi

  local status=$(curl -s -o /dev/null -w "%{http_code}" -H "Host: carolinemizen.art" "http://localhost:8080" 2>/dev/null || echo "000")
  if [ "$status" = "200" ]; then
    print_success "carolinemizen.art routing → $status"
  else
    print_error "carolinemizen.art routing → $status"
    ((failed++))
  fi

  local status=$(curl -s -o /dev/null -w "%{http_code}" -H "Host: pp.seanmizen.com" "http://localhost:8080" 2>/dev/null || echo "000")
  if [ "$status" = "200" ]; then
    print_success "pp.seanmizen.com routing → $status"
  else
    print_error "pp.seanmizen.com routing → $status"
    ((failed++))
  fi

  echo ""
  if [ $failed -eq 0 ]; then
    print_success "Nginx gateway passed!"
    return 0
  else
    print_error "$failed nginx route(s) failed"
    return 1
  fi
}

main() {
  print_header "Deployment Smoke Test"
  echo "Mode: $MODE"
  echo ""

  local total_failed=0

  if [ "$MODE" = "cloudflared" ] || [ "$MODE" = "both" ]; then
    test_cloudflared || ((total_failed++))
    echo ""
  fi

  if [ "$MODE" = "flyio" ] || [ "$MODE" = "both" ]; then
    test_flyio || ((total_failed++))
    test_flyio_nginx || ((total_failed++))
    echo ""
  fi

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
