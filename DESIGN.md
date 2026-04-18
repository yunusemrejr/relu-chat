# ReLU.chat Landing Page — Design Specification

## Project Context
- **Product**: ReLU.chat — Privacy-first, browser-based, open-source chatbots
- **Current offering**: Game Theory Chat (on-device NLU assistant for Nash equilibrium, Shapley value, auctions, etc.)
- **Tech**: Pure HTML/CSS/JS, single file, no build step, FTP deployment
- **Existing product theme**: Dark mode (#08090a canvas), blue accent (#1e3a8a / #3b82f6), Inter font

## Visual Theme & Atmosphere
- **Inspiration**: Linear (dark precision) + Vercel (engineered clarity) + xAI (futuristic minimalism)
- **Mood**: Technical, trustworthy, cutting-edge but approachable
- **Dark mode only** — the product is dark-only, stay consistent
- **No generic SaaS tropes**: No purple gradients, no bland centered blobs, no generic "3 cards with icons"

## Color Palette

| Token | Value | Usage |
|-------|-------|-------|
| --bg | #08090a | Page background |
| --bg-elevated | #0d0f12 | Elevated surfaces |
| --bg-card | rgba(255,255,255,0.008) | Card backgrounds (darker) |
| --bg-card-hover | rgba(255,255,255,0.025) | Card hover |
| --border | rgba(255,255,255,0.06) | Default borders |
| --border-hover | rgba(59,130,246,0.4) | Hover borders |
| --text-primary | #f7f8f8 | Headings, primary text |
| --text-secondary | #8a8f98 | Body, descriptions |
| --text-tertiary | #5a5f68 | Meta, captions |
| --accent | #1e3a8a | Primary accent (deep blue) |
| --accent-light | #3b82f6 | Light accent (bright blue) |
| --accent-glow | rgba(30,58,138,0.3) | Glow effects |
| --success | #27ae60 | Success states |

## Typography
- **Font**: Inter (already used in product), system-ui fallback
- **Scale**:
  - Display: 56-72px, weight 700, tracking -0.04em, line-height 1.05
  - H1: 40-48px, weight 700, tracking -0.03em
  - H2: 28-32px, weight 600, tracking -0.02em
  - H3: 18-20px, weight 600, tracking -0.01em
  - Body: 16-17px, weight 400, line-height 1.7
  - Small: 13-14px, weight 500
  - Micro: 11-12px, weight 500, uppercase, tracking 0.08em
- **Font features**: "cv01", "ss03" for Inter

## Layout Principles
- **Max width**: 1100px content, 1200px hero
- **Spacing scale**: 4, 8, 12, 16, 24, 32, 48, 64, 96px
- **Border radius**: 6px (sm), 10px (md), 14px (lg), 20px (xl)
- **Mobile-first**: Stack everything at < 640px

## Depth & Elevation
- **Shadow-as-border** (Vercel technique):
  - Card: `rgba(0,0,0,0.08) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 4px, rgba(0,0,0,0.04) 0px 8px 16px -8px`
  - Card hover: `rgba(59,130,246,0.15) 0px 0px 0px 1px, rgba(59,130,246,0.08) 0px 4px 12px, rgba(59,130,246,0.12) 0px 16px 32px -12px`
- **Background glow**: Radial gradients at top for ambient light

## Sections Required

### 1. Navigation (sticky, minimal)
- Logo left, nav links center (optional), CTA right
- Backdrop blur on scroll
- Height: ~64px

### 2. Hero
- Large display headline with gradient text
- Subheadline explaining value prop
- Two CTAs: "Try Game Theory Chat" (primary) + "View on GitHub" (ghost)
- Subtle animated background: CSS-only mesh gradient or particle field
- Feature pills/badges below CTAs

### 3. How It Works (3 steps)
- Horizontal at desktop, stacked at mobile
- Step number + title + description
- Subtle connecting line between steps
- Emphasize: on-device, privacy-first, no server calls

### 4. Features Grid
- 4-6 features in a 2x2 or 3x2 grid
- Each: icon + title + description
- Use existing badge/icon style from product
- Highlight: On-device AI, Privacy-first, Open-source, No LLMs, LaTeX support, Browser-based

### 5. Chatbot Showcase
- Large card for Game Theory Chat
- Screenshot/mockup or visual representation
- Tags, description, CTA
- Ready for future chatbots (grid layout)

### 6. Newsletter/CTA Section
- Same signup form as existing but more polished
- Better visual treatment (elevated card with glow)

### 7. Footer
- Links, copyright, GitHub link
- Minimal, clean

## Animation & Motion
- **Hero text**: Subtle fade-in + translateY on load
- **Cards**: Staggered fade-in on scroll (IntersectionObserver, CSS only)
- **Hover**: Smooth transitions (0.2-0.25s cubic-bezier(0.4, 0, 0.2, 1))
- **Background**: Very subtle animated gradient (CSS @keyframes, low opacity)
- **Respect prefers-reduced-motion**

## Component Styles

### Buttons
- **Primary**: bg var(--accent), white text, 10px radius, padding 12px 20px, weight 600
- **Ghost**: bg transparent, border var(--border), same radius/padding
- **Hover primary**: bg var(--accent-hover), glow shadow
- **Hover ghost**: bg var(--bg-card-hover), border var(--border-hover)

### Cards
- bg var(--bg-card), border 1px var(--border), radius 14px
- Top border gradient on hover: `linear-gradient(90deg, transparent, rgba(59,130,246,0.4), transparent)`
- Transform translateY(-2px) on hover

### Icons
- 20-24px, stroke var(--accent-light)
- Inside 40-44px rounded square with gradient bg

## Anti-Patterns to AVOID
- No purple gradients
- No generic "3 feature cards with emoji/icons" without context
- No centered blobs or meaningless shapes
- No placeholder content
- No Inter as a lazy default (we use it intentionally because the product uses it)
- No magic numbers — use the spacing scale
- No generic stock photos
- No excessive animations

## Performance Requirements
- Single HTML file, inline CSS and JS
- No external JS libraries
- Google Fonts: Inter only, preconnected
- CSS animations only, no heavy JS
- Images: logo.png only, lazy loaded if possible
- Target: < 100KB total HTML
