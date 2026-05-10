# Versen Project Context

Updated: 2026-05-10

## What This Is

Versen is a Swedish member-based ecommerce/deals site. The public site is a static frontend with Vercel serverless APIs. It is integrated with GitHub, Vercel, Shopify, Resend, and payment/checkout flows through environment-backed services.

## Where The Code Lives

Use this folder for actual development:

`/Users/arminhurtic/Documents/Codex/2026-04-26/du-ska-arbeta-i-mitt-github`

Remote:

`git@github.com:ArminH00/versen-site.git`

Branch:

`main`

## Key Files

- `index.html` - home page
- `produkter.html` - product/deals listing
- `produkt.html` - product detail page
- `kundkorg.html` - cart/checkout page
- `konto.html` - signup/login/member flow
- `medlemskap.html` and `medlemskap-aktivt.html` - membership pages
- `forslag.html` - member suggestions
- `installningar.html` - account/settings/subscription controls
- `villkor.html`, `integritet.html`, `returer.html`, `faq.html`, `kontakt.html` - launch/legal/support pages
- `script.js` - main frontend and integration logic
- `styles.css` - all major visual styling
- `design-system/index.html` - reusable Versen component/style guide
- `api/` - Vercel serverless endpoints
- `INTEGRATION.md` - integration notes

## Design System Contract

Before making visual changes, read `AGENTS.md`, this file, `design-system/index.html`, and the relevant section of `styles.css`.

The current Versen design direction is not loose inspiration. It is a strict mobile-first premium commerce language based on the user's reference image at:

`/Users/arminhurtic/Downloads/8C476048-4F22-4D6D-BC70-9AC4CE0305E8.PNG`

Future edits must preserve the system:

- Premium curated commerce, not generic ecommerce.
- Editorial, cinematic, luxury minimal, calm, realistic, and production-ready.
- Warm white pages, soft black text, minimal gray, subtle lines, soft rounded corners, restrained shadows, and generous whitespace.
- Serif editorial headings with clean sans UI text.
- Sticky minimal top header, fullscreen overlay menu, no bottom navigation.
- Natural vertical editorial scrolling only; no horizontal page movement on mobile.
- Storefront remains open for browsing. Membership only appears during checkout as the unlock step.
- Product imagery should be isolated and realistic with soft studio lighting and subtle pedestal shadows.
- Avoid dramatic glow effects, fake floating products, oversized shadows, AI-looking compositions, cluttered cards, dense grids, and dashboard-like UI.

All future pages should reuse the existing component system: header, overlay menu, hero/drop sections, product cards, product grids, filter pills, membership checkout blocks, cart/checkout rows, account cards, footer, and category/list sections.

## Deployment Flow

1. Make focused edits.
2. Run `git diff --check`.
3. Run any relevant local checks for changed logic.
4. Commit to `main`.
5. Push to GitHub.
6. Verify Vercel production deployment reaches `READY`.

## Recent Known State

Recent launch polish has already been pushed:

- Home/product/account/cart/legal copy was updated for launch.
- A reusable Versen design system page exists at `design-system/index.html`.
- The public site has been rebuilt toward the reference image's mobile-first premium commerce direction.
- Bottom navigation has been removed; the site uses a sticky minimal top header and fullscreen overlay menu.
- Public browsing remains open; membership is reserved for checkout unlock.
- Homepage was refined to reduce section clutter: category-card grid, studio-edit section, and long feeling-discovery section were removed.
- Hero/product compositions were adjusted to feel calmer and less cropped.
- Horizontal overflow must stay fixed across pages.
- Product countdown now counts to next Thursday 12:00.
- Countdown should display plain text like `7 dagar och 3h kvar av dessa deals`.
- If days are 0, countdown should show only hours.
- Green rings/outlines around CTA/status buttons were removed; only subtle luster/glow should remain.
- Latest known styling request: countdown must be stylish text only, no timer pill.

## Product Copy Principles

- Swedish, short, confident, and launch-ready.
- Avoid placeholder phrases such as `utkast`, `low-key`, or internal explanations.
- Mention spam folder after verification email is sent.
- Legal/support pages should include sensible launch-safe terms, including reservation for typos and 14-day returns from delivery.

## Things To Watch

- Light theme contrast.
- Product detail descriptions in white boxes on mobile.
- Text clipping on product/ad cards.
- Mobile Safari viewport/header overlap.
- Do not add obvious decorative rings around buttons unless specifically requested.
