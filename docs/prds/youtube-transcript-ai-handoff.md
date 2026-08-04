# PRD: Summarize YouTube videos with popular AI services

## Problem Statement

A user watching a captioned YouTube video wants a quick summary in a familiar AI service. Today, this requires opening the transcript, copying a large amount of text, switching to an AI assistant, pasting the text, and submitting a prompt. Long transcripts make this slow and unreliable: text can be copied incompletely, lost between tabs, or rejected by the destination interface.

The existing extension scaffold should become a focused product. On a supported YouTube page, it retrieves every available caption from the selected track, prepares a summary prompt, opens the selected AI service, transfers the complete prompt, and submits it immediately. The extension does not call model APIs, store API keys, or display its own generated summary.

## Solution

The extension provides a compact popup on YouTube video pages. It detects available captions, selects the best track using predictable rules, and lets the user change it when needed. The user selects a persistent summary language, chooses which supported AI services appear, and starts the operation with the corresponding quick-action button.

The extension extracts timestamped caption segments, groups them into readable blocks with a starting timestamp, and removes technical noise without semantic truncation. It adds a short, fixed English instruction, explicitly tells the service which selected language to use for the summary, and includes video metadata. The prepared prompt is stored temporarily inside the extension. A new destination tab retrieves the prompt in chunks, assembles it in the editor, verifies that the full text was inserted, and submits it. The system clipboard is not the primary transport and is not overwritten during the normal flow.

Large transcripts move between extension components in chunks and are never silently truncated. If the destination rejects the length, changes its interface, requires sign-in, or blocks automatic submission, the complete prompt remains in temporary storage and the user can retry or copy it manually. The extension guarantees complete transfer to the editor, but it cannot guarantee that a particular model accepts the prompt because limits vary by service, plan, and model.

## User Stories

1. As a YouTube user, I want the extension to recognize a standard video page so summarization is available only in the right context.
2. As a YouTube user, I want to know whether the current video has captions so I can tell whether summarization is possible.
3. As a YouTube user, I want the extension to retrieve the complete available transcript so the summary covers the whole video.
4. As a YouTube user, I want both manual and auto-generated captions supported so the feature works on as many videos as possible.
5. As a multilingual-video viewer, I want to see the selected track's language so I know which source text will be sent.
6. As a multilingual-video viewer, I want to choose another available caption track so the AI receives the source version I need.
7. As a user, I want a sensible default track so typical use requires no setup.
8. As a user, I want manual captions preferred over auto-generated captions in the same language so the source is higher quality.
9. As a user, I want separate actions for my chosen AI services so the selected service starts with one click.
10. As a ChatGPT user, I want a new conversation with the prepared prompt so existing conversations are not mixed with the new video.
11. As a Perplexity user, I want a new query page with the prepared prompt so I can use my familiar service.
12. As a user, I want the video title and URL added automatically so the result retains source context.
13. As a user, I want a clear summary instruction added automatically so I do not need to write one.
14. As a user, I want to select and save a summary language independently of the caption language so future results use my preferred language without repeated setup.
15. As a user, I want repeated whitespace and caption control characters removed so the prompt does not waste context on noise.
16. As a user, I want meaningful caption text preserved without paraphrasing before submission so the AI receives unchanged source material.
17. As a user, I want every readable transcript block to include its starting timestamp so the AI can connect summary points to moments in the video.
18. As a long-video viewer, I want the extension to transfer the transcript internally in chunks so component message limits do not lose text.
19. As a very-long-video viewer, I want the assembled prompt verified before submission so a partial insertion cannot look successful.
20. As a very-long-video viewer, I want to see the prompt size and a warning about possible service limits so rejection is not surprising.
21. As a user, I want the extension never to silently truncate the transcript so I can trust that it is complete.
22. As a user, I want automatic submission after a complete insertion so the process truly takes one action.
23. As a user, I want automatic submission blocked after an incomplete insertion so the AI does not summarize corrupted text.
24. As a user, I want a clear error when an AI service changes its interface so I understand the failure.
25. As a user, I want the complete prompt left in the editor when automatic submission fails so I can submit it manually.
26. As a user, I want to copy the complete prompt with one button when automatic insertion fails so the work is not lost.
27. As a signed-out AI-service user, I want the extension to wait for sign-in and continue afterward so authentication does not destroy the prompt.
28. As a user, I want retries to avoid accidental duplicate submissions so duplicate conversations are not created.
29. As a user, I want visible retrieval, opening, insertion, and sent states so a long operation does not look frozen.
30. As a user, I want to cancel an operation that has not been sent so a mistaken video or service choice does not create an unwanted prompt.
31. As a user of a video without captions, I want a specific no-captions message so I do not expect an impossible result.
32. As a user of an unavailable, private, or age-restricted video, I want a distinct access error so I can fix the cause or stop.
33. As a user, I want temporary prompt data deleted after confirmed submission so watched content does not accumulate.
34. As a user, I want unfinished prompts deleted automatically after 30 minutes so old transcripts are not stored indefinitely.
35. As a user, I want captions sent only to my chosen AI service, never to the developer's server.
36. As a user, I want the normal flow to preserve my system clipboard.
37. As a user, I want extension permissions limited to YouTube and supported AI-service domains rather than every visited site.
38. As a user, I want the extension to detect a new video after YouTube SPA navigation so it continues to work without a full page reload.
39. As a user, I want to summarize the current video again in another AI service so I can compare results.
40. As a keyboard user, I want every popup control available without a mouse.
41. As a screen-reader user, I want statuses and errors announced accessibly so I understand operation progress.
42. As an extension developer, I want YouTube markup dependencies isolated in one adapter so a break can be fixed without rewriting the product.
43. As an extension developer, I want editor changes in one AI service isolated from the others so each integration can be updated independently.
44. As an extension developer, I want diagnostics to distinguish retrieval, storage, insertion, and submission so failures can be located without logging transcript contents.
45. As an extension developer, I want the origin of adapted Obsidian Web Clipper logic documented so the MIT license is honored and behavioral comparisons use a known version.

## Implementation Decisions

- The first release targets Chromium browsers and Manifest V3. Firefox support waits until destination integrations stabilize.
- The extension keeps only the popup, background service worker, and targeted content scripts. New-tab overrides, DevTools, side panels, demo options pages, boilerplate components, and all-sites content scripts are removed.
- Permissions are limited to storage and the required YouTube and supported AI-service domains. Broad URL access is not used. Increased local storage is acceptable only for temporary transfer of long transcripts.
- `YouTube Transcript Source` is a deep adapter. Its public contract accepts the current video context and returns video metadata, caption tracks, and ordered segments with start time, duration, and text. YouTube DOM and internal-data details do not escape the module.
- Caption retrieval and parsing are adapted from Obsidian Web Clipper 1.7.1 at commit `c2fbae9645332ecf8d05dcf281483693b5054213` and Defuddle 0.19.2. The Reader is not ported. Substantially adapted code retains required MIT notices; Obsidian branding, icons, and marketing assets are not copied.
- Default track order is: the active player track when detectable; otherwise a track matching the page or video language; otherwise a manual track; otherwise the first auto-generated track. When several tracks exist, the popup provides a compact language-and-type selector.
- Extraction uses data already available to the current video page. It requires no YouTube API key, OAuth, or channel-owner account access.
- YouTube navigation is treated as SPA navigation. A changed video ID invalidates old state, cancels unfinished extraction, and starts a new availability check.
- `Transcript Composer` accepts metadata and segments and returns a canonical prompt plus completeness data. It removes only technical noise such as invisible characters, malformed line breaks, and redundant whitespace. It never shortens, summarizes, translates, or paraphrases meaningful source text. The fixed prompt copy is always English; the selected summary language appears only as an explicit output-language instruction.
- Every transcript block has a compact `H:MM:SS` or `M:SS` starting timestamp. Boundaries follow source structure and readability rather than a rigid 30-second interval.
- `Large Payload Handoff` is a deep transport module. It accepts one string of any practical length and provides a one-time identifier, a chunk sequence, size information, and a checksum. The consumer confirms successful assembly, after which the data is deleted.
- Temporary extension storage is the primary transport, not the system clipboard or one large runtime message. Bounded chunks are read sequentially to avoid peak string copies and implicit message limits.
- Unfinished payloads expire after 30 minutes. Successful submission deletes them immediately. A confirmed payload cannot be issued again, reducing duplicate-submission risk.
- The extension imposes no product-level transcript length limit and does not truncate. Before opening the AI service, it displays text size and an approximate token count. This is a warning, not a reason to shorten content.
- `AI Destination` defines a shared contract: open a clean destination page, wait for the editor, insert the complete prompt, verify the inserted content, submit it, and confirm the result or return a typed error.
- Each supported AI service uses an independent adapter. Service-specific selectors, contenteditable behavior, and button activation do not leak outside the relevant adapter.
- A destination tab receives only an opaque, one-time operation ID. Transcript text never travels through URLs, query parameters, or fragments.
- Automatic submission is allowed only after the editor is verified to contain the complete prompt. Verification uses normalized-text length and checksum, not merely the presence of text.
- If the user is signed out, the operation remains pending within its TTL and can continue after sign-in. The extension never enters credentials or bypasses CAPTCHA.
- If the editor contains the complete text but submission is unavailable, the tab remains open with the populated field and a visible status for manual submission. If insertion fails, the popup offers explicit manual copying.
- External context limits cannot be known reliably in advance because they vary by service, plan, and model. The MVP attempts one complete prompt and does not split the transcript into several AI messages, which would change semantics and could trigger premature answers without solving the total-context limit.
- When a service explicitly rejects the prompt length, the extension reports the rejection without marking the operation successful and preserves the full payload until TTL expiry. Multi-step summarization or compression is a separate future product decision.
- One operation moves through caption retrieval, preparation, destination opening, editor or authentication waiting, insertion, verification, submission, success, recoverable error, terminal error, and cancellation states.
- A concurrent retry for the same video and destination requires confirmation or replaces only an unsent operation. A sent operation is never repeated automatically.
- Logs may include video ID, track type, sizes, stage durations, and error codes, but never caption text, private URL parameters, prompt contents, or AI account data.
- The popup is the extension's only product surface. It contains availability, the persistent summary-language choice, optional track selection, separate service buttons, progress, and recovery actions. The MVP needs no settings page.
- Only the summary language is persisted. An explicitly selected track applies to the current video, while the active YouTube player track has first priority. Captions are never stored as user history.

## Testing Decisions

- Tests focus on observable public behavior: retrieved tracks and segments, composed prompts, complete payload reconstruction, operation states, and user actions. They do not lock down private function names, internal call order, or component structure.
- Vitest provides the test runner, and DOM contracts use a lightweight browser environment with minimal saved fixtures.
- `YouTube Transcript Source` fixture-based contract tests cover manual and auto-generated tracks, multiple languages, the active track, no captions, empty events, HTML entities, line breaks, CJK text, duplicate segments, malformed responses, and changed video IDs.
- Fixtures stay minimal and contain no user data. At least one fixture reflects the selected upstream Obsidian Web Clipper commit so the port preserves key behavior.
- Track-selection rules are tested separately as pure observable behavior across combinations of language, type, and active status.
- `Transcript Composer` tests cover order and full-text preservation, technical-noise cleanup, Unicode and emoji, readable block grouping, starting timestamps, metadata, English instruction copy, explicit selected output language, and deterministic size estimates.
- A synthetic multi-megabyte composer fixture proves there is no truncation by comparing checksums rather than storing a huge snapshot.
- `Large Payload Handoff` tests chunk boundaries, boundary Unicode, service-worker restart recovery, one-time confirmation, repeat reads before confirmation, immediate deletion, TTL cleanup, cancellation, and concurrent operations.
- A corrupted-or-missing-chunk transport test ensures incomplete data is never marked ready or passed to a destination adapter.
- The shared `AI Destination` contract runs against both adapters with scenarios for an immediately available editor, delayed editor, required sign-in, complete insertion, partial insertion, disabled send button, successful manual fallback, and unexpected DOM changes.
- AI-service DOM fixtures contain only the minimal editor and button structure rather than snapshots of whole third-party pages.
- Operation coordinator tests use fake browser APIs for the successful path, cancellation at every asynchronous stage, SPA navigation, destination-tab closure, retries, authentication timeout, and prevention of duplicate submission.
- Popup tests use user actions and accessible names for summary-language selection, service buttons, conditional track selection, the no-captions disabled state, progress, size warnings, retry, copy fallback, and keyboard navigation.
- Log secrecy is tested by passing a unique marker through a failure path and verifying that it never appears in diagnostic events.
- Before release, manual smoke tests run against current public YouTube and every supported AI-service page because external DOM contracts can change independently. The set includes short and long videos, manual and auto-generated captions, multiple languages, no captions, signed-out services, and a prompt rejected for length.
- Success requires verified complete insertion and actual prompt submission. Opening a tab alone is not success.

## Out of Scope

- Obsidian Web Clipper features such as an interactive caption reader, pinned player, current-segment highlighting, autoscroll, transcript search, and timestamp navigation.
- Downloading video or audio, or performing speech-to-text for videos without captions.
- YouTube Data API, YouTube OAuth, or private caption retrieval for user-owned videos.
- Direct AI-service API integrations, API-key storage, or paying for prompts on the user's behalf.
- A proprietary summary model, backend, or AI response displayed inside the extension.
- Providers other than ChatGPT, Perplexity, Claude, Gemini, Qwen, and DeepSeek.
- Custom prompt text, summary style, or result format beyond choosing the response language.
- Sending a transcript as several AI messages, map-reduce summarization, or local pre-compression to bypass context limits.
- Bypassing rate limits, CAPTCHA, anti-bot systems, paid restrictions, or third-party authentication requirements.
- Playlists, batch processing, or a background queue.
- Summary history, bookmarks, Markdown or Obsidian export, cloud sync, or content analytics.
- Arbitrary websites, podcasts, local files, or live streams without a complete available track.
- Firefox, Safari, and mobile browsers in the first release.

## Further Notes

- The working product name is `Summarize It`. In this PRD, a transcript is the selected YouTube caption track after technical normalization and grouping into timestamped blocks; summarization is the request performed by the external AI service.
- A request to “copy the text” means transferring the complete text. The normal implementation uses internal handoff for reliability and clipboard preservation; explicit copying remains a fallback.
- Obsidian Web Clipper 1.7.1 includes an interactive synchronized YouTube transcript. Its related Defuddle 0.19.2 logic is a proven source for segment retrieval and grouping, not a model for the entire interface.
- Obsidian Web Clipper source code is MIT-licensed. Substantial adaptations must preserve copyright and license text; trademarks and visual assets are not transferred.
- MVP completion means that, on a supported public captioned YouTube video, one user action starts an operation and automatically submits a prompt containing the complete timestamped transcript in a new tab of the selected service. Any incomplete transfer blocks submission while keeping the text recoverable.
- Completeness applies to data available to the YouTube page. The extension cannot recover missing, hidden, or inaccessible caption fragments.
- At the time this PRD was written, the repository was a nearly unchanged browser-extension template. This document, the root glossary, and the first ADR establish product terminology and initial module boundaries.
- Publishing to an issue tracker first requires replacing the template's upstream remote with the product repository and authorizing access. Issues must not be created in `JohnBra/vite-web-extension`, which is a third-party source project.
