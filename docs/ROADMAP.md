# Sabet development roadmap

## Product objective

A predictable Moodle workflow: the user always knows which question is being processed, what happened, and why it stopped. Correct control filling and correct AI reasoning are separate outcomes.

## v1.0.0 foundation

- One durable session owner with explicit phases and bounded retries.
- Question/request identity, manual-edit detection, and cancellation.
- Separate Moodle adapter, provider driver, editor bridge, and popup.
- Unit, integration, lint, build, and isolated-browser checks.
- Simple progress with always-reachable start/stop controls; API settings in a separate view.

## Next: compatibility first

Build a versioned fixture matrix for the Moodle installations actually used: Moodle version/theme, CodeRunner version, question behavior, language, and editor type.

Acceptance: choice, multi-select, numerical, short answer, matching, essay, CodeRunner gaps, and Ace each pass extraction/fill/read-back tests. Include deferred feedback, AJAX CHECK, full-page PRECHECK/CHECK reload, multiple questions per page, and pagination. Unsupported variants stop with an actionable message.

## Then: provider reliability

Maintain dated fixtures for Gemini, ChatGPT, and Claude. Test login missing, send disabled, upload failure, streaming draft JSON, timeout, tab close, and changed page layout.

Acceptance: one request produces at most one accepted answer; incomplete input/upload never reports success; no action reaches an unrelated tab. Run opt-in live smoke checks only on ungraded test prompts.

## Then: release discipline

Require npm run check and browser tests in CI. Document the tested browser/Moodle/provider matrix per release, package the dist artifact, and keep a changelog. Add optional-host permission onboarding only with tests for grants, revocation, and resume.

Acceptance: no unresolved critical workflow regressions, reproducible build, no known dependency advisories, visible diagnosis for timeouts, and an explicit list of compatibility limits.

## Definition of done

A feature has a clear user outcome, regression evidence, working start/cancel/reload behavior, and updated support documentation. Do not use total test count or a claim of zero bugs as the release criterion. No new provider or question type ships without fixture coverage.
