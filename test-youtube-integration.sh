#!/bin/bash
# YouTube Integration Test Script
# This script helps you test the YouTube integration endpoints

set -e

# Configuration
API_BASE="http://localhost:8788/api/overseas"
AUTH_TOKEN="${YOUTUBE_AUTH_TOKEN:-}"
ACCOUNT_ID="${YOUTUBE_ACCOUNT_ID:-}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
log_info() {
    echo -e "${BLUE}ℹ ${1}${NC}"
}

log_success() {
    echo -e "${GREEN}✓ ${1}${NC}"
}

log_error() {
    echo -e "${RED}✗ ${1}${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠ ${1}${NC}"
}

print_header() {
    echo -e "\n${BLUE}╔════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║ ${1}${NC}"
    echo -e "${BLUE}╚════════════════════════════════════════╝${NC}\n"
}

# Check prerequisites
check_prerequisites() {
    print_header "Checking Prerequisites"
    
    if ! command -v curl &> /dev/null; then
        log_error "curl is not installed"
        exit 1
    fi
    log_success "curl is available"
    
    if ! command -v jq &> /dev/null; then
        log_warning "jq is not installed (optional, for better JSON formatting)"
    else
        log_success "jq is available"
    fi
    
    if [ -z "$AUTH_TOKEN" ]; then
        log_error "AUTH_TOKEN not set. Please set it with:"
        echo -e "${YELLOW}export YOUTUBE_AUTH_TOKEN='your-auth-token'${NC}"
        exit 1
    fi
    log_success "AUTH_TOKEN is set"
}

# Test 1: List all connected YouTube accounts
test_list_accounts() {
    print_header "Test 1: List Connected Accounts"
    
    log_info "Endpoint: GET /youtube/accounts"
    
    response=$(curl -s -X GET \
        "${API_BASE}/youtube/accounts" \
        -H "Authorization: Bearer ${AUTH_TOKEN}" \
        -H "Content-Type: application/json")
    
    if command -v jq &> /dev/null; then
        echo "$response" | jq '.'
    else
        echo "$response"
    fi
    
    # Extract first account ID
    if command -v jq &> /dev/null; then
        first_id=$(echo "$response" | jq -r '.items[0].id // empty')
        if [ -n "$first_id" ]; then
            ACCOUNT_ID="$first_id"
            log_success "Found account: $ACCOUNT_ID"
        else
            log_warning "No accounts found"
        fi
    fi
}

# Test 2: Get account details
test_get_account() {
    print_header "Test 2: Get Account Details"
    
    if [ -z "$ACCOUNT_ID" ]; then
        log_error "ACCOUNT_ID not set. Run test_list_accounts first or set:"
        echo -e "${YELLOW}export YOUTUBE_ACCOUNT_ID='account-id'${NC}"
        return
    fi
    
    log_info "Endpoint: GET /youtube/accounts/${ACCOUNT_ID}"
    
    response=$(curl -s -X GET \
        "${API_BASE}/youtube/accounts/${ACCOUNT_ID}" \
        -H "Authorization: Bearer ${AUTH_TOKEN}" \
        -H "Content-Type: application/json")
    
    if command -v jq &> /dev/null; then
        echo "$response" | jq '.'
    else
        echo "$response"
    fi
}

# Test 3: Get channel info
test_channel_info() {
    print_header "Test 3: Get Channel Information"
    
    if [ -z "$ACCOUNT_ID" ]; then
        log_error "ACCOUNT_ID not set"
        return
    fi
    
    log_info "Endpoint: GET /youtube/accounts/${ACCOUNT_ID}/channel-info"
    
    response=$(curl -s -X GET \
        "${API_BASE}/youtube/accounts/${ACCOUNT_ID}/channel-info" \
        -H "Authorization: Bearer ${AUTH_TOKEN}" \
        -H "Content-Type: application/json")
    
    if command -v jq &> /dev/null; then
        echo "$response" | jq '.'
    else
        echo "$response"
    fi
}

# Test 4: Get videos
test_get_videos() {
    print_header "Test 4: Get Videos"
    
    if [ -z "$ACCOUNT_ID" ]; then
        log_error "ACCOUNT_ID not set"
        return
    fi
    
    max_results="${1:-10}"
    log_info "Endpoint: GET /youtube/accounts/${ACCOUNT_ID}/videos?maxResults=${max_results}"
    
    response=$(curl -s -X GET \
        "${API_BASE}/youtube/accounts/${ACCOUNT_ID}/videos?maxResults=${max_results}" \
        -H "Authorization: Bearer ${AUTH_TOKEN}" \
        -H "Content-Type: application/json")
    
    if command -v jq &> /dev/null; then
        echo "$response" | jq '.videos[] | {title, id, viewCount, commentCount}'
    else
        echo "$response"
    fi
}

# Test 5: Get comments
test_get_comments() {
    print_header "Test 5: Get All Comments"
    
    if [ -z "$ACCOUNT_ID" ]; then
        log_error "ACCOUNT_ID not set"
        return
    fi
    
    max_results="${1:-20}"
    log_info "Endpoint: GET /youtube/accounts/${ACCOUNT_ID}/comments?maxResults=${max_results}"
    
    response=$(curl -s -X GET \
        "${API_BASE}/youtube/accounts/${ACCOUNT_ID}/comments?maxResults=${max_results}" \
        -H "Authorization: Bearer ${AUTH_TOKEN}" \
        -H "Content-Type: application/json")
    
    if command -v jq &> /dev/null; then
        echo "$response" | jq '.comments[] | {authorName, textDisplay: (.textDisplay | .[0:100]), likeCount}'
    else
        echo "$response"
    fi
}

# Test 6: Get analytics
test_get_analytics() {
    print_header "Test 6: Get Channel Analytics"
    
    if [ -z "$ACCOUNT_ID" ]; then
        log_error "ACCOUNT_ID not set"
        return
    fi
    
    log_info "Endpoint: GET /youtube/accounts/${ACCOUNT_ID}/analytics"
    
    response=$(curl -s -X GET \
        "${API_BASE}/youtube/accounts/${ACCOUNT_ID}/analytics" \
        -H "Authorization: Bearer ${AUTH_TOKEN}" \
        -H "Content-Type: application/json")
    
    if command -v jq &> /dev/null; then
        echo "$response" | jq '.'
    else
        echo "$response"
    fi
}

# Test 7: Sync account
test_sync_account() {
    print_header "Test 7: Sync Account Data"
    
    if [ -z "$ACCOUNT_ID" ]; then
        log_error "ACCOUNT_ID not set"
        return
    fi
    
    log_info "Endpoint: POST /youtube/accounts/${ACCOUNT_ID}/sync"
    
    response=$(curl -s -X POST \
        "${API_BASE}/youtube/accounts/${ACCOUNT_ID}/sync" \
        -H "Authorization: Bearer ${AUTH_TOKEN}" \
        -H "Content-Type: application/json")
    
    if command -v jq &> /dev/null; then
        echo "$response" | jq '.'
    else
        echo "$response"
    fi
    
    log_success "Account synced"
}

# Test 8: Connect new account
test_connect_account() {
    print_header "Test 8: Connect New Account"
    
    echo -e "${YELLOW}This test requires your OAuth credentials.${NC}\n"
    
    read -p "Enter Client ID: " client_id
    read -sp "Enter Client Secret: " client_secret
    echo
    read -sp "Enter Refresh Token: " refresh_token
    echo
    
    log_info "Endpoint: POST /youtube/connect"
    
    response=$(curl -s -X POST \
        "${API_BASE}/youtube/connect" \
        -H "Authorization: Bearer ${AUTH_TOKEN}" \
        -H "Content-Type: application/json" \
        -d "{
            \"clientId\": \"${client_id}\",
            \"clientSecret\": \"${client_secret}\",
            \"refreshToken\": \"${refresh_token}\"
        }")
    
    if command -v jq &> /dev/null; then
        echo "$response" | jq '.'
    else
        echo "$response"
    fi
}

# Main menu
show_menu() {
    print_header "YouTube Integration Test Menu"
    
    echo "Available tests:"
    echo "  1) List all connected accounts"
    echo "  2) Get account details"
    echo "  3) Get channel information"
    echo "  4) Get videos"
    echo "  5) Get comments"
    echo "  6) Get analytics"
    echo "  7) Sync account"
    echo "  8) Connect new account"
    echo "  9) Run all tests"
    echo "  0) Exit"
    echo
}

run_all_tests() {
    test_list_accounts
    
    if [ -n "$ACCOUNT_ID" ]; then
        test_get_account
        test_channel_info
        test_get_videos 5
        test_get_comments 10
        test_get_analytics
    else
        log_warning "Skipping account-specific tests (no accounts found)"
    fi
    
    print_header "All Tests Completed"
}

# Main script
main() {
    check_prerequisites
    
    # If argument provided, run specific test
    if [ $# -gt 0 ]; then
        case "$1" in
            1) test_list_accounts ;;
            2) test_get_account ;;
            3) test_channel_info ;;
            4) test_get_videos "${2:-10}" ;;
            5) test_get_comments "${2:-20}" ;;
            6) test_get_analytics ;;
            7) test_sync_account ;;
            8) test_connect_account ;;
            9) run_all_tests ;;
            *) log_error "Unknown test: $1" ;;
        esac
    else
        # Interactive menu
        while true; do
            show_menu
            read -p "Select test (0-9): " choice
            
            case "$choice" in
                1) test_list_accounts ;;
                2) test_get_account ;;
                3) test_channel_info ;;
                4) test_get_videos ;;
                5) test_get_comments ;;
                6) test_get_analytics ;;
                7) test_sync_account ;;
                8) test_connect_account ;;
                9) run_all_tests ;;
                0) log_success "Goodbye!"; exit 0 ;;
                *) log_error "Invalid option" ;;
            esac
            
            read -p "Press Enter to continue..."
        done
    fi
}

# Run main function
main "$@"
