# Shared Context — relu.chat

## Project Overview

**relu.chat** is a coming soon landing page for a browser-based, privacy-first open-source chatbot platform that does not rely on LLMs.

- **Domain**: reult.chat
- **Hosting**: Linux shared hosting (Namecheap-style), Pure-FTPd with TLS
- **Backend**: PHP + SQLite for email collection
- **Deployment**: FTP via lftp-based deployment script

## Current State

- [x] Git repository initialized
- [x] Coming soon page (index.html)
- [x] PHP email handler with SQLite (api/subscribe.php)
- [x] .htaccess security configuration
- [x] Custom error pages (404, 403, 500)
- [x] FTP deployment script (deploy.sh)
- [ ] Production deployment — **BLOCKED: FTP credentials need verification**

## Architecture Decisions

1. **Single HTML file** for the coming soon page — no build step, no framework
2. **PHP backend** for email capture — shared hosting constraint
3. **SQLite** for data storage — no MySQL setup needed
4. **SFTP/FTP deployment** via lftp script with environment variable credentials
5. **Dark theme** inspired by Linear/ElevenLabs design systems — cinematic, privacy-focused aesthetic

## Active Tasks

All code is complete. Deployment blocked pending FTP credential verification.

## Open Flags

- **WARNING — FTP Auth**: Server (Pure-FTPd, port 21, TLS) accepts username `relu@reult.chat` but rejects password. Credentials in `ftp-info.txt` may be incorrect or account not yet active. Verify in hosting control panel.

## Forward Notes

- Logo (logo.png, 596x622 RGBA PNG) relocated to `assets/`
- Server: IP 199.188.200.140, Pure-FTPd with TLS, cert doesn't match IP (auto-disabled in script)
- Remote path: /home/eartctvi/reult.chat
- Once FTP credentials are verified, run `./deploy.sh` to push to production
