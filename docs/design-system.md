# Design System

Extracted and formalized from `DESIGN.md`.

## Philosophy

Inspired by Linear, Vercel, and xAI. Technical precision meets elegant minimalism. **Dark mode only**.

## Color Tokens

- `--bg`: #08090a
- `--bg-elevated`: #0d0f12
- `--accent`: #1e3a8a / `--accent-light`: #3b82f6
- `--text-primary`: #f7f8f8
- Subtle borders, glassmorphic cards, and tasteful glows

## Typography

- **Font**: Inter (with `cv01`, `ss03` features)
- Strict scale from 72px display down to 11px microcopy
- Generous line heights and tight tracking on headings

## Core Components

- **Cards**: Elevated with subtle shadows-as-borders, hover glow
- **Buttons**: Primary (blue) and ghost styles with smooth transitions
- **Navigation**: Sticky with backdrop blur
- **Hero**: Large gradient text, subtle animated background

## Anti-Patterns (Strictly Forbidden)

- Purple gradients
- Generic blob illustrations
- Centered "feature cards with emojis"
- Excessive animation
- Any light mode elements

## Implementation

- Root CSS variables in `index.html` and chat `styles.css`
- All animations via CSS `transition` and `@keyframes`
- Follows mobile-first, max-width 1100-1200px layout
- Performance target: single HTML file under 100KB (excluding model)

Full specification available in root [`DESIGN.md`](../DESIGN.md).
