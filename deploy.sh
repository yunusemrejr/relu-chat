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
    
    # Create a temporary lftp script file to avoid bash escaping issues
    local lftp_script_file=$(mktemp)
    trap "rm -f '${lftp_script_file}'" EXIT
    
    # Write lftp settings
    cat > "${lftp_script_file}" << EOF
set ftp:ssl-allow no
set ftp:passive-mode on
set net:timeout 30
set net:max-retries 3
EOF
    
    if [[ "${VERBOSE:-0}" == "1" ]]; then
        echo "set xfer:log true" >> "${lftp_script_file}"
    fi
    
    # Build mirror command with exclude patterns
    # lftp mirror uses extended regex, * must be escaped as \\*
    local mirror_cmd="mirror --reverse"
    if [[ "${DRY_RUN:-0}" == "1" ]]; then
        log "DRY RUN MODE - No files will be transferred"
        mirror_cmd+=" --dry-run"
    else
        mirror_cmd+=" --delete --continue"
    fi
    
    # Add exclude patterns - lftp mirror uses extended regex
    # In lftp mirror, use [*] to match literal asterisk, or use regex patterns
    # Write directly to file to avoid bash escaping issues
    printf '%s' "${mirror_cmd}" >> "${lftp_script_file}"
    printf ' --exclude ".git/"' >> "${lftp_script_file}"
    printf ' --exclude ".agent-logs/"' >> "${lftp_script_file}"
    printf ' --exclude "_backups/"' >> "${lftp_script_file}"
    printf ' --exclude ".deployments/"' >> "${lftp_script_file}"
    printf ' --exclude ".env"' >> "${lftp_script_file}"
    printf ' --exclude ".env.local"' >> "${lftp_script_file}"
    printf ' --exclude ".env.example"' >> "${lftp_script_file}"
    printf ' --exclude "deploy.sh"' >> "${lftp_script_file}"
    printf ' --exclude ".deployignore"' >> "${lftp_script_file}"
    printf ' --exclude "[*].log"' >> "${lftp_script_file}"
    printf ' --exclude "data/[*].db"' >> "${lftp_script_file}"
    printf ' --exclude "data/[*].sqlite"' >> "${lftp_script_file}"
    printf ' --exclude "data/[*].sqlite3"' >> "${lftp_script_file}"
    printf ' --exclude ".idea/"' >> "${lftp_script_file}"
    printf ' --exclude ".vscode/"' >> "${lftp_script_file}"
    printf ' --exclude "node_modules/"' >> "${lftp_script_file}"
    printf ' --exclude "vendor/"' >> "${lftp_script_file}"
    printf ' --exclude ".DS_Store"' >> "${lftp_script_file}"
    printf ' --exclude "Thumbs.db"' >> "${lftp_script_file}"
    printf ' --exclude "README.md"' >> "${lftp_script_file}"
    printf ' --exclude "context.md"' >> "${lftp_script_file}"
    printf ' --verbose "%s" "%s"\n' "${LOCAL_ROOT}" "${FTP_REMOTE}" >> "${lftp_script_file}"
    echo "quit" >> "${lftp_script_file}"
    
    log "Connecting to server..."
    
    # Execute lftp with the script file
    if lftp -u "${FTP_USER}","${FTP_PASS}" "ftp://${FTP_HOST}:${FTP_PORT}" < "${lftp_script_file}" 2>&1 | tee -a "${LOG_FILE}"; then
        log "Deployment completed successfully"
        return 0
    else
        local exit_code=${PIPESTATUS[0]}
        log_error "Deployment failed with exit code ${exit_code}"
        
        # Retry with longer timeout
        log "Attempting retry with longer timeout..."
        sed -i 's/set net:timeout 30/set net:timeout 60/' "${lftp_script_file}"
        sed -i 's/set net:max-retries 3/set net:max-retries 5/' "${lftp_script_file}"
        
        if lftp -u "${FTP_USER}","${FTP_PASS}" "ftp://${FTP_HOST}:${FTP_PORT}" < "${lftp_script_file}" 2>&1 | tee -a "${LOG_FILE}"; then
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