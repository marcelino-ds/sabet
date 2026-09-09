# Contributing to Sabet

Use Node.js 24. Install with npm ci, then run npm run check.

## Change workflow

1. Identify the observable failure or intended behavior.
2. Add a failing regression/fixture test at the affected boundary.
3. Implement the smallest coherent change.
4. Run unit/integration tests, lint, and build.
5. Run browser tests for changes to flow, popup, editor access, or injector.
6. Record any live Moodle/provider compatibility gap in the PR.

## Boundaries

- Session writes belong to background/session-store.js.
- Content depends on the Moodle adapter and an acknowledged RPC contract.
- Never infer the answer's target from whichever field is empty when a response arrives.
- Preserve cancellation after every asynchronous boundary before side effects.
- Validate complete answers before filling. Never claim success from a partial code substring.
- Provider-specific selectors live in shared/providers.js.
- Treat page content and model output as untrusted text.
- Keep final submission manual.

## Validation

```sh
npm run check
npx playwright install chromium
npm run test:browser
```

Windows can set SABET_BROWSER_PATH to an installed Chrome/Edge executable. Browser tests use a disposable profile and controlled quiz/provider fixtures; they must never operate on a live graded attempt.

For a new Moodle variant, include extraction, filling, verification, and navigation fixtures. For a provider change, include the response/input fixture and state when the live selectors were checked. Do not mark a provider verified solely because selector strings exist.

See docs/ROADMAP.md for priority order and release gates.
