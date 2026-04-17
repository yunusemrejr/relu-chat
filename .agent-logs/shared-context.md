# Shared Context — relu.chat

## Project Overview

**relu.chat** is a coming soon landing page for a browser-based, privacy-first open-source chatbot platform that does not rely on LLMs.

- **Domain**: reult.chat
- **Hosting**: Namecheap Linux shared hosting, Pure-FTPd with TLS (port 21)
- **Backend**: PHP + SQLite for email collection
- **Deployment**: FTP via lftp-based deployment script

## Current State

- [x] Git repository initialized
- [x] Coming soon page (index.html)
- [x] PHP email handler with SQLite (api/subscribe.php)
- [x] .htaccess security configuration
- [x] Custom error pages (404, 403, 500)
- [x] FTP deployment script (deploy.sh)
- [ ] Production deployment — **BLOCKED: FTP credentials invalid**

## Architecture Decisions

1. **Single HTML file** for the coming soon page — no build step, no framework
2. **PHP backend** for email capture — shared hosting constraint
3. **SQLite** for data storage — no MySQL setup needed
4. **FTP deployment** via lftp mirror with env var credentials
5. **Dark theme** inspired by Linear/ElevenLabs design systems

## Active Tasks

All code complete. Deployment blocked pending valid FTP credentials.

## Open Flags

- **WARNING — FTP Auth**: Pure-FTPd server on 199.188.200.140:21 rejects all credential combinations:
  - `relu@reult.chat` + known password → 530 (username recognized, password wrong)
  - `eartctvi` (cPanel username) + known password → 530
  - `relu` + known password → 530
  - **Action needed**: Verify FTP credentials in Namecheap cPanel → FTP Accounts. The password from ftp-info.txt is incorrect or the account is inactive.

## Forward Notes

- **Namecheap path mapping**: Login lands at `/home/eartctvi/`, web root is `public_html/`
- **Deploy script defaults updated**: FTP_USER=eartctvi, FTP_REMOTE=public_html
- **To deploy**: Update `.env` with correct FTP password from cPanel, then run `./deploy.sh`
- Logo (596x622 RGBA PNG) in `assets/`
- Server cert doesn't match IP — script auto-disables cert verification
