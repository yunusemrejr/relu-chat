# .agent-logs — Agent Memory & Coordination Layer

This directory is the **agent memory and coordination layer**, separate from Git version control. It exists so that multiple AI agents (or the same agent across sessions) can maintain context, detect conflicts, and coordinate work on this codebase.

## What's Inside

| File/Directory | Purpose |
|---|---|
| `README.md` | This file — explains how to read the logs |
| `index.md` | Master session index (one row per agent session) |
| `active-agents.md` | Live registry of all currently running agents |
| `shared-context.md` | Project state, flags, direction updates, forward notes |
| `conflict-alerts.md` | Active and resolved conflict events between agents |
| `completion-log.md` | Completed task records |
| `migration-log.md` | Schema migration events for log format changes |
| `collision-log.md` | Collision detection and resolution records |
| `sessions/` | Per-session detailed log files |
| `messages/` | Per-agent direct message queues |
| `archive/` | Compressed old logs |
| `pending-registration/` | Staging for race-condition registrations |

## How to Read index.md

Each row represents one agent session:

| Column | Meaning |
|---|---|
| Session ID | Unique identifier for the session |
| Nickname | Human-readable agent nickname (e.g., SwiftForge-9X2L) |
| Start Time | When the session began (UTC) |
| Project Type | web-app, cli-tool, library, etc. |
| Summary | One-line description of what was done |
| Log File | Path to the detailed session log |

## How to Read Session Files

Session files in `sessions/` contain:
- Session header (agent ID, nickname, start time, project type)
- Carry-over context from prior sessions
- Numbered action entries (pre-action declaration + post-action result)
- Session summary with completed tasks, open tasks, and carry-over notes

## For Human Reviewers

If you're reviewing what an AI agent did:
1. Check `index.md` for the most recent session
2. Read the corresponding session file in `sessions/`
3. Check `shared-context.md` for any flags, warnings, or open decisions
4. Check `conflict-alerts.md` if multiple agents were active
