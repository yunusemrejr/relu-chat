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
    mkdir -p "$(dirname "${LOG_FILE}")" 2>/dev/null || true
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
    
    # Build exclude patterns for lftp mirror
    local exclude_patterns=(
        '.git' '.agent-logs' '_backups' '.env*' 'deploy.sh' '.deployignore'
        '*.log' 'data/*.db' 'data/*.sqlite' 'data/*.sqlite3'
        '.idea' '.vscode' 'node_modules' 'vendor' '.DS_Store' 'Thumbs.db'
        'README.md' 'context.md'
    )
    
    local exclude_args=""
    for pattern in "${exclude_patterns[@]}"; do
        exclude_args+=" --exclude='${pattern}'"
    done
    
    # Build lftp settings
    local lftp_settings="set ftp:ssl-allow no; set ftp:passive-mode yes; set net:timeout 30; set net:max-retries 3; set ftp:transfer-mode binary;"
    
    if [[ "${VERBOSE:-0}" == "1" ]]; then
        lftp_settings+=" set xfer:log true;"
    fi
    
    # Build mirror command
    local mirror_cmd="mirror --reverse"
    if [[ "${DRY_RUN:-0}" == "1" ]]; then
        log "DRY RUN MODE - No files will be transferred"
        mirror_cmd+=" --dry-run"
    else
        mirror_cmd+=" --delete --continue"
    fi
    mirror_cmd+=" --verbose${exclude_args} '${LOCAL_ROOT}' '${FTP_REMOTE}'"
    
    # Full lftp command: lftp -c "open -u user,pass host:port; settings; mirror_cmd; quit"
    local full_cmd="lftp -c \"open -u '${FTP_USER}','${FTP_PASS}' ftp://${FTP_HOST}:${FTP_PORT}; ${lftp_settings} ${mirror_cmd}; quit\""
    
    log "Connecting to server..."
    
    if eval "${full_cmd}" 2>&1 | tee -a "${LOG_FILE}"; then
        log "Deployment completed successfully"
        return 0
    else
        local exit_code=${PIPESTATUS[0]}
        log_error "Deployment failed with exit code ${exit_code}"
        
        # Retry with longer timeout
        log "Attempting retry with longer timeout..."
        local retry_settings="set ftp:ssl-allow no; set ftp:passive-mode yes; set net:timeout 60; set net:max-retries 5; set ftp:transfer-mode binary;"
        local retry_cmd="lftp -c \"open -u '${FTP_USER}','${FTP_PASS}' ftp://${FTP_HOST}:${FTP_PORT}; ${retry_settings} ${mirror_cmd}; quit\""
        
        if eval "${retry_cmd}" 2>&1 | tee -a "${LOG_FILE}"; then
            log "Retry successful"
            return 0
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