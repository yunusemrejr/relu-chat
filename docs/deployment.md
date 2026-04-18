# Deployment

ReLU.chat is deployed as a **static site** via FTP to shared hosting (likely Namecheap/cPanel).

## Deployment Process

1. **Local Development**
   ```bash
   python -m http.server 8000
   # or
   npx serve .
   ```

2. **Production Deployment**
   - Copy `deploy.sh.example` → `deploy.sh`
   - Configure `.env` with FTP credentials
   - Run `./deploy.sh`

The script uses `lftp` with mirroring, respects `.deployignore`, and logs every deployment to `.deployments/`.

## Server Configuration

- `.htaccess` handles:
  - Custom error pages (`errors/404.html`, etc.)
  - Caching headers for static assets
  - Security headers
  - Gzip compression

## CI/CD Note

Currently manual. Future versions could add GitHub Actions with `lftp` or rsync over SSH.

See `deploy.sh` and root `README.md` for full instructions.
