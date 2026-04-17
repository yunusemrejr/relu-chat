# ReLU.chat

Free, browser-based, privacy-first open-source chatbots that don't rely on LLMs.

## Project Structure

```
.
├── index.html          # Coming soon page with email capture
├── assets/
│   └── logo.png        # Brand logo
├── api/
│   └── subscribe.php   # Email subscription handler (PHP + SQLite)
├── data/               # SQLite database storage (git-ignored)
├── errors/
│   ├── 404.html        # Custom 404 page
│   ├── 403.html        # Custom 403 page
│   └── 500.html        # Custom 500 page
├── .htaccess           # Apache/LiteSpeed security config
├── deploy.sh           # FTP deployment script
├── .deployignore       # Files excluded from deployment
└── .env                # FTP credentials (git-ignored)
```

## Development

The coming soon page is a single HTML file with embedded CSS/JS — no build step required. Open `index.html` in a browser to preview.

## Deployment

1. Copy `.env.example` to `.env`
2. Fill in your FTP credentials from your hosting control panel
3. Run `DRY_RUN=1 ./deploy.sh` to test
4. Run `./deploy.sh` to deploy

### Environment Variables

| Variable | Description | Default |
|---|---|---|
| `FTP_HOST` | Server IP or hostname | `199.188.200.140` |
| `FTP_USER` | cPanel/FTP username | `eartctvi` |
| `FTP_PASS` | FTP password | (required) |
| `FTP_REMOTE` | Remote web root | `public_html` |
| `FTP_PORT` | FTP port | `21` |

## License

MIT
