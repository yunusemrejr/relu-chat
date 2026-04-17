# Shared Context — relu.chat

## Project Overview

**relu.chat** is a coming soon landing page for a browser-based, privacy-first open-source chatbot platform that does not rely on LLMs.

- **Domain**: reult.chat
- **Hosting**: Linux shared hosting (Namecheap-style), Apache/LiteSpeed
- **Backend**: PHP + SQLite for email collection
- **Deployment**: FTP via lftp-based deployment script

## Current State

- [x] Git repository initialized
- [ ] Coming soon page (in progress)
- [ ] PHP email handler with SQLite
- [ ] .htaccess security configuration
- [ ] Custom error pages
- [ ] FTP deployment script
- [ ] Production deployment

## Architecture Decisions

1. **Single HTML file** for the coming soon page — no build step, no framework
2. **PHP backend** for email capture — shared hosting constraint
3. **SQLite** for data storage — no MySQL setup needed
4. **SFTP/FTP deployment** via lftp script with environment variable credentials
5. **Dark theme** inspired by Linear/ElevenLabs design systems — cinematic, privacy-focused aesthetic

## Active Tasks

1. Create coming soon page with email capture
2. PHP + SQLite email handler
3. .htaccess with security, redirects, custom error pages
4. FTP deployment script
5. Push to production

## Open Flags

None currently.

## Forward Notes

- Logo (logo.png, 596x622 RGBA PNG) needs to be relocated to `assets/` directory
- FTP credentials stored in `ftp-info.txt` — must be moved to env vars in deploy script
- Server IP: 199.188.200.140, User: relu@reult.chat, Remote path: /home/eartctvi/reult.chat
