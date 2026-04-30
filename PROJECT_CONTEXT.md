# Versen Project Context

Updated: 2026-04-30

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
- `api/` - Vercel serverless endpoints
- `INTEGRATION.md` - integration notes

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

