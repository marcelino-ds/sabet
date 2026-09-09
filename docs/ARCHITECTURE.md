# Sabet architecture

## Ownership

Only background/session-store.js writes sabetSession. The worker serializes mutations and increments a revision on every write. A content document must present its expected revision before a transition. Popup and provider tabs cannot overwrite session storage.

chrome.storage.local is restricted to trusted extension contexts. Content and injector use bounded RPC; API keys are read only by the popup and background.

## Lifecycle

```text
solving -> waiting_for_answer -> answer_ready -> applying
                                                |
                                           apply_ready
                                                |
                                prechecking -> checking
                                                |
                  solving <- navigating <- complete
                                ^
                              retrying

Terminal: done, aborted, error
```

A persisted request contains a session ID, request ID, question key, target URL, input snapshot, payload, and deadline. Provider results are stored before content is notified. Reading state recovers missed notifications.

Dispatches and failures are counted in storage. Claiming a request twice cannot send it twice, including after worker recreation. Chrome alarms provide recovery if an API request or provider tab never finishes.

Filling, precheck, check, and navigation are claimed before execution. Reload during an uncertain fill stops for review. Reload after CHECK reads the resulting grade instead of clicking again.

## Moodle boundary

The adapter extracts from .qtext and uses the same option reader as the filler. The target fingerprint includes question/option content; feedback and hidden sequence inputs are excluded. Before applying an answer, both the target and original inputs must still match.

A type-specific answer shape is checked before writing controls. Partial text/matching arrays are rejected. CodeRunner writes use a narrow MAIN-world function through chrome.scripting, because page-created Ace instances are unavailable in an isolated content world. The result is read back and compared before success.

Official Moodle grades determine correctness. Deferred-feedback questions count as processed with an unknown grade. PRECHECK is a readiness signal, not proof of a correct answer. Final submission is never automated.

## Provider boundary

The service binds each request to a provider tab and hostname. Only that tab can fetch its payload or return its result. A fresh conversation per request prevents previous answers from being treated as current responses.

The injector drives local DOM controls. It must verify prompt input and wait for a stable answer after streaming stops. Provider selectors belong in shared/providers.js; live compatibility needs rechecking when sites change.

API mode uses a fixed selected transport and model. Failures consume a bounded retry budget. It does not silently switch accounts or open a web-provider fallback.

## Failure behavior

Cancellation aborts local waits immediately and marks the durable session terminal. Late completions are discarded by request identity and phase checks. Closing the Moodle tab cancels the session; closing a pending provider tab consumes a request failure.

The saved history is bounded and contains phase/timing metadata. Terminal sessions discard payload/answer bodies. The final status remains visible for review.

## Interface

The popup has a fixed header/action area and a scrollable middle within the browser popup height. The home view contains AI selection, an optional note, and Start; active work shows progress and Stop. API settings have their own view. The shared UI copy layer maps internal phases and errors to short user-facing messages, while raw diagnostics remain in session storage. Both page overlays share the same bounded, isolated panel.
