# Versen Project Notes For Codex

This is the live Versen website/project.

## Start Here

- Main repo path: `/Users/arminhurtic/Documents/Codex/2026-04-26/du-ska-arbeta-i-mitt-github`
- GitHub remote: `git@github.com:ArminH00/versen-site.git`
- Main branch: `main`
- Production domain: `versen.se`
- Vercel project id seen in previous work: `project-f8ph5`
- Vercel team id seen in previous work: `team_fIjOO4l8HYFpm2hcqxtnuAn8`

When a new chat starts for this project, read `PROJECT_CONTEXT.md` first, then inspect `git status`, recent commits, and the files relevant to the request.

## How To Work

- User usually wants direct implementation and live push/deploy when asking for site changes.
- Keep edits small and launch-safe.
- Do not expose or commit secrets. Environment variables live outside the repo/Vercel.
- Use `apply_patch` for manual file edits.
- Before pushing, run at least a syntax/sanity check such as `git diff --check`. Run broader tests/builds if the change touches runtime logic.
- After changes, commit to `main`, push to GitHub, and verify the Vercel production deployment is `READY` when the user asks to go live.

## Important Integrations

- Vercel deploys the site.
- GitHub remote is the source of truth.
- Serverless endpoints are in `api/`.
- Shopify and Resend are integrated through backend/API and environment variables.

## Visual/Product Direction

- Versen is a Swedish member-based deals shop.
- The canonical visual direction is the mobile-first premium commerce system created from the user's reference image: `/Users/arminhurtic/Downloads/8C476048-4F22-4D6D-BC70-9AC4CE0305E8.PNG`.
- Treat `design-system/index.html` and the `vs-*` component/tokens in `styles.css` as the reusable source of truth before editing visual pages.
- Tone: Swedish, clean, premium, launch-ready, concise, editorial.
- UI should stay minimal, soft, polished, calm, and spacious. Avoid heavy decorative outlines, loud pills, clutter, and dense marketplace layouts.
- Light theme must stay readable; watch white boxes and low-contrast text.
- Mobile Safari screenshots have been the main QA target.

## Mandatory Design Rules

- Do not redesign pages independently. Reuse the existing Versen design system, component proportions, spacing rhythm, typography hierarchy, and page pacing.
- The site should feel like real premium curated commerce: editorial, cinematic, luxury minimal, calm, modern, and production-ready.
- It must not feel like a Shopify template, generic ecommerce marketplace, gym shop, dashboard, futuristic concept, or Dribbble experiment.
- Mobile is the primary product. Build mobile-first, then expand carefully to desktop.
- Use a warm white background, soft blacks, restrained gray, subtle dividers, soft rounded corners, subtle shadows only, generous whitespace, and strong type hierarchy.
- Use the sticky minimal top header and fullscreen overlay menu pattern. Do not add bottom navigation.
- Storefront browsing must remain open. Membership should only appear as an unlock step during checkout unless the user explicitly changes that model.
- Pages should scroll vertically only. Prevent horizontal overflow globally and check mobile widths after layout changes.
- Homepage pacing should stay curated and restrained. Do not add heavy category-card grids, repetitive studio-edit sections, or long stacked discovery sections unless explicitly requested.

## Product Presentation Rules

- Product presentation must feel studio-shot, isolated, realistic, and premium.
- Prefer transparent/isolated product imagery with soft studio lighting, subtle pedestal shadows, realistic scale, and calm spacing.
- Do not use exaggerated floating effects, dramatic glow, oversized shadows, AI-looking product compositions, or experimental product layouts.
- Product cards should be quiet and editorial: image-led, spacious, minimal metadata, clear price/action, and no generic ecommerce clutter.

## Current Launch Decisions

- Products/deals reset weekly on Thursday 12:00 Europe/Stockholm time.
- Countdown text should be plain elegant text, not a pill.
- Countdown wording should be like `7 dagar och 3h kvar av dessa deals`; if days are 0, only show hours.
- Temporary launch/cover page should disappear at 00:00 launch time if still present.
- Copy should avoid placeholder/draft wording.
