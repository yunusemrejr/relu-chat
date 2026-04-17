# Session: NeonPilot-7TQ3F
- agent_id: neon-pilot-7tq3f
- nickname: NeonPilot-7TQ3F
- start_time: 2026-04-17T00:00:00Z
- project_type: web-app
- working_directory: /home/area51/Desktop/FTP/relu.chat
- summarized_instructions: |
  - Create coming soon page for relu.chat — a privacy-first, browser-based open-source chatbot platform (no LLMs)
  - Use PHP + SQLite for email gathering
  - Protect SQLite from public reading via .htaccess
  - Create .htaccess with: no directory indexing, custom error pages, www→non-www redirect, file protection, XSS headers
  - Create custom 404/403/500 error pages
  - Relocate logo.png to assets/
  - Create FTP deployment script with env var credentials
  - Push everything to production at reult.chat
- carry_over_context: |
  First session. Codebase was a blank slate — only logo.png and ftp-info.txt existed. Git repo initialized. .agent-logs infrastructure created.
