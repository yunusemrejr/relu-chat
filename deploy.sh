#!/bin/bash
#
# ReLU.chat — Production Deployment Script
# 
# This script deploys local changes to the production server via SFTP/FTP.
# It uses lftp for reliable, resumable transfers with smart sync logic.
#
# Usage:
#   ./deploy.sh                    # Deploy all changes
#   DRY_RUN=1 ./deploy.sh          # Preview changes without uploading
#   VERBOSE=1 ./deploy.sh          # Show detailed transfer logs
#
# Requirements:
#   - lftp (install: sudo apt install lftp)
#   - Git (all changes must be committed before deployment)
#
# Environment Variables (set in .env or export before running):
#   FTP_HOST   - Server IP or hostname (default: 199.188.200.140)
#   FTP_USER   - FTP username (default: relu@reult.chat)
#   FTP_PASS   - FTP password (required, no default)
#   FTP_REMOTE - Remote path (default: /)
#   FTP_PORT   - FTP port (default: 21)
#

set -euo pipefail

# =============================================================================
# Configuration
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_ROOT="${SCRIPT_DIR}"
LOG_FILE="${SCRIPT_DIR}/.deployments/deploy-$(date +%Y%m%d-%H%M%S).log"
BACKUP_DIR="${SCRIPT_DIR}/_backups"
ENV_FILE="${SCRIPT_DIR}/.env"

# Default values
FTP_HOST="${FTP_HOST:-199.188.200.140}"
FTP_USER="${FTP_USER:-relu@reult.chat}"
FTP_PASS="${FTP_PASS:-}"
FTP_REMOTE="${FTP_REMOTE:-/}"
FTP_PORT="${FTP_PORT:-21}"

# Load .env file if it exists (but never commit it)
if [[ -f "${ENV_FILE}" ]]; then
    set -a
    source "${ENV_FILE}"
    set +a
fi

# =============================================================================
# Validation
# =============================================================================

log() {
    local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $*"
    mkdir -p "$(dirname "${LOG_FILE}")" 2>/dev/null || true
    echo "$msg" | tee -a "${LOG_FILE}"
}

log_error() {
    local msg="[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $*"
    echo "$msg" | tee -a "${LOG_FILE}" >&2
}

die() {
    log_error "$@"
    exit 1
}

# Check required tools
command -v lftp >/dev/null 2>&1 || die "lftp is required. Install with: sudo apt install lftp"
command -v git >/dev/null 2>&1 || die "git is required"

# Check required credentials
[[ -n "${FTP_PASS}" ]] || die "FTP_PASS is required. Set it in .env or export FTP_PASS"

# Check git status - require clean working tree
cd "${LOCAL_ROOT}"
if ! git diff-index --quiet HEAD --; then
    log_error "Uncommitted changes detected. Please commit all changes before deployment."
    log_error "Run 'git status' to see pending changes."
    exit 1
fi
log "Git working tree is clean"

# =============================================================================
# Backup
# =============================================================================

create_backup() {
    log "Creating local backup..."
    mkdir -p "${BACKUP_DIR}"
    local backup_name="backup-$(date +%Y%m%d-%H%M%S)"
    local backup_path="${BACKUP_DIR}/${backup_name}"
    
    # Backup only files that will be deployed (respect .deployignore)
    rsync -a --delete \
        --exclude='.git' \
        --exclude='.agent-logs' \
        --exclude='_backups' \
        --exclude='.env' \
        --exclude='.env.local' \
        --exclude='deploy.sh' \
        --exclude='.deployignore' \
        --exclude='*.log' \
        --exclude='data/*.db' \
        --exclude='data/*.sqlite' \
        --exclude='data/*.sqlite3' \
        --exclude='.idea' \
        --exclude='.vscode' \
        --exclude='node_modules' \
        --exclude='vendor' \
        --exclude='.DS_Store' \
        --exclude='Thumbs.db' \
        --exclude='README.md' \
        --exclude='context.md' \
        "${LOCAL_ROOT}/" "${backup_path}/"
    
    log "Backup created: ${backup_path}"
}

# =============================================================================
# Deployment
# =============================================================================

deploy() {
    log "Starting deployment to ${FTP_HOST}:${FTP_PORT}${FTP_REMOTE}"
    log "User: ${FTP_USER}"
    
    # Build lftp command
    local lftp_cmd="lftp -c"
    local lftp_script=""
    
    # Connection settings
    lftp_script+="set ftp:ssl-allow no; "  # Plain FTP (change to 'yes' for FTPS)
    lftp_script+="set ftp:passive-mode yes; "
    lftp_script+="set net:timeout 30; "
    lftp_script+="set net:reconnect-interval-base 5; "
    lftp_script+="set net:max-retries 3; "
    lftp_script+="set ftp:transfer-mode binary; "
    
    # Logging
    if [[ "${VERBOSE:-0}" == "1" ]]; then
        lftp_script+="set xfer:log true; "
    fi
    
    # Dry run mode
    if [[ "${DRY_RUN:-0}" == "1" ]]; then
        log "DRY RUN MODE - No files will be transferred"
        lftp_script+="mirror --reverse --dry-run --exclude='.git' --exclude='.agent-logs' --exclude='_backups' --exclude='.env*' --exclude='deploy.sh' --exclude='.deployignore' --exclude='*.log' --exclude='data/*.db' --exclude='data/*.sqlite' --exclude='data/*.sqlite3' --exclude='.idea' --exclude='.vscode' --exclude='node_modules' --exclude='vendor' --exclude='.DS_Store' --exclude='Thumbs.db' --exclude='README.md' --exclude='context.md' "
    else
        # Actual deployment with delete to sync exactly
        lftp_script+="mirror --reverse --delete --continue --exclude='.git' --exclude='.agent-logs' --exclude='_backups' --exclude='.env*' --exclude='deploy.sh' --exclude='.deployignore' --exclude='*.log' --exclude='data/*.db' --exclude='data/*.sqlite' --exclude='data/*.sqlite3' --exclude='.idea' --exclude='.vscode' --exclude='node_modules' --exclude='vendor' --exclude='.DS_Store' --exclude='Thumbs.db' --exclude='README.md' --exclude='context.md' "
    fi
    
    lftp_script+="--verbose '${LOCAL_ROOT}' '${FTP_REMOTE}'"
    
    # Execute deployment
    log "Connecting to server..."
    
    if eval ${lftp_cmd} -u "${FTP_USER}","${FTP_PASS}" "ftp://${FTP_HOST}:${FTP_PORT}" -e "${lftp_script}; quit" 2>&1 | tee -a "${LOG_FILE}"; then
        log "Deployment completed successfully"
    else
        local exit_code=${PIPESTATUS[0]}
        log_error "Deployment failed with exit code ${exit_code}"
        
        # Retry with different settings
        log "Attempting retry with alternative settings..."
        
        # Try with explicit passive mode and longer timeout
        local retry_script="set ftp:ssl-allow no; set ftp:passive-mode yes; set net:timeout 60; set net:max-retries 5; "
        
        if [[ "${DRY_RUN:-0}" == "1" ]]; then
            retry_script+="mirror --reverse --dry-run --exclude='.git' --exclude='.agent-logs' --exclude='_backups' --exclude='.env*' --exclude='deploy.sh' --exclude='.deployignore' --exclude='*.log' --exclude='data/*.db' --exclude='data/*.sqlite' --exclude='data/*.sqlite3' --exclude='.idea' --exclude='.vscode' --exclude='node_modules' --exclude='vendor' --exclude='.DS_Store' --exclude='Thumbs.db' --exclude='README.md' --exclude='context.md' "
        else
            retry_script+="mirror --reverse --delete --continue --exclude='.git' --exclude='.agent-logs' --exclude='_backups' --exclude='.env*' --exclude='deploy.sh' --exclude='.deployignore' --exclude='*.log' --exclude='data/*.db' --exclude='data/*.sqlite' --exclude='data/*.sqlite3' --exclude='.idea' --exclude='.vscode' --exclude='node_modules' --exclude='vendor' --exclude='.DS_Store' --exclude='Thumbs.db' --exclude='README.md' --exclude='context.md' "
        fi
        
        retry_script+="--verbose '${LOCAL_ROOT}' '${FTP_REMOTE}'"
        
        if eval ${lftp_cmd} -u "${FTP_USER}","${FTP_PASS}" "ftp://${FTP_HOST}:${FTP_PORT}" -e "${retry_script}; quit" 2>&1 | tee -a "${LOG_FILE}"; then
            log "Retry successful"
        else
            die "Deployment failed after retry. Check credentials and server connectivity."
        fi
    fi
}

# =============================================================================
# Main
# =============================================================================

main() {
    # Create log and backup directories
    mkdir -p "$(dirname "${LOG_FILE}")"
    mkdir -p "${BACKUP_DIR}"
    
    log "=========================================="
    log "ReLU.chat Deployment Script"
    log "=========================================="
    log "Local root: ${LOCAL_ROOT}"
    log "Remote: ftp://${FTP_HOST}:${FTP_PORT}${FTP_REMOTE}"
    log "User: ${FTP_USER}"
    log "Mode: ${DRY_RUN:-0}"
    log "=========================================="
    
    # Create backup before deployment
    if [[ "${SKIP_BACKUP:-0}" != "1" ]]; then
        create_backup
    fi
    
    # Run deployment
    deploy
    
    log "=========================================="
    log "Deployment finished"
    log "Log file: ${LOG_FILE}"
    log "=========================================="
}

main "$@"