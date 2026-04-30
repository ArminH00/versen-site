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
- Tone: clean, premium, launch-ready, concise Swedish copy.
- UI should stay minimal, soft, and polished. Avoid heavy decorative outlines, loud pills, and clutter.
- Light theme must stay readable; watch white boxes and low-contrast text.
- Mobile Safari screenshots have been the main QA target.

## Current Launch Decisions

- Products/deals reset weekly on Thursday 12:00 Europe/Stockholm time.
- Countdown text should be plain elegant text, not a pill.
- Countdown wording should be like `7 dagar och 3h kvar av dessa deals`; if days are 0, only show hours.
- Temporary launch/cover page should disappear at 00:00 launch time if still present.
- Copy should avoid placeholder/draft wording.

