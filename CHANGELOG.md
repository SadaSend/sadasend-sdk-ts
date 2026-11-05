# Changelog

All notable changes to the `sadasend` TypeScript SDK will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.4] - 2026-11-06

### Added
- **Official Playwright Drop-in Test Fixtures (`sadasend/playwright`)**:
  - Exported drop-in `test` runner and `expect` via `"./playwright"` subpath export (`import { test, expect } from 'sadasend/playwright'`).
  - Added `ephemeralInbox` fixture provisioning isolated test inboxes with real-time SSE streaming (`waitForOtp`, `waitForCode`, `waitForMagicLink`, `waitForMessage`, `getMessages`).
  - Zero-polling reactive OTP resolution (<150ms) eliminating slow, flaky test timeouts.
  - Automatic test lifecycle teardown: inboxes are automatically deleted when tests conclude, preventing inbox leaks and quota consumption.
  - Added `createInbox` multi-inbox factory fixture for team invitation and multi-user test workflows.
- **First-Class React Email (`@react-email/components`) Support**:
  - Added native `react?: ReactEmailElement` support to `SendInput` for `emails.send()` and `emails.batch()`.
  - Automatically compiles React Email components (e.g. `<WelcomeEmail />`) to HTML and plain-text at runtime using `@react-email/render` or `react-dom/server` fallback.
  - Zero compile-time or runtime dependencies: loads dynamically only when `react` is passed.
  - Automatically suppresses leaking in-memory component references to the wire payload.
  - Exported `renderReactEmail()`, `ReactEmailElement`, `RenderedEmail`, and `ReactEmailRenderOptions` from `sadasend` root.
- **`client.testing.waitForCode` & `testing.inboxes.code` Field Aliasing**:
  - Normalized response properties so `code = json.code ?? json.otp ?? ''` and `otp = json.otp ?? json.code ?? null`.
  - Developer and browser-agent code accessing `res.data.code` or `res.data.otp` functions seamlessly with 100% backward compatibility.
- **`client.inboxes.stream(id)` Real SSE Streaming & `streamUrl(id)`**:
  - Added `client.inboxes.streamUrl(id: string): string` returning the formatted absolute stream endpoint for browsers, EventSource, or webhook bridges.
  - Refactored `client.inboxes.stream(id, options)` to stream Server-Sent Events natively instead of buffering raw stream chunks as JSON.
  - Added native, zero-dependency async iterator `[Symbol.asyncIterator]()` on `InboxStreamResponse` (via `parseSseStream`) yielding typed events (`connected`, `otp`, `message`, `heartbeat`) in real-time.
- **Volume Surge Anomaly Hold & Security Hold Reason**:
  - Added `held?: boolean` and `holdReason?: string | null` to `SendResult` and `Message` interfaces.
  - When an outbound send triggers the adaptive volume surge detector (projected daily volume exceeds safety multiplier, e.g. 3x 7-day baseline) or security hold policies, `held: true`, `holdType: 'security'`, and a descriptive human-readable `holdReason` are preserved on the returned result and on message retrieval.
  - Updated test fixtures in `test/provenanceSdk.test.ts` to assert that `held`, `holdType`, and `holdReason` are faithfully returned and parsed on `emails.send` and `emails.get`.
- **Documentation & Link Traffic Attribution**:
  - Attached standardized UTM campaign tracking parameters (`utm_source=npm&utm_medium=readme&utm_campaign=typescript_sdk`) across all canonical documentation, API references, console, and status links in `README.md`.

## [0.1.3] - 2026-11-05

### Added
- Deliverability radar, security improvements, and initial agent safety loop-breaker controls.

## [0.1.2] - 2026-10-30

### Added
- **Inbound MX Routing & Webhook Ingestion Engine (`client.inbound`)**:
  - `sadasend.inbound.routes`: `list()`, `create()`, `get()`, `update()`, `delete()`.
  - `sadasend.inbound.messages`: `list()`, `get()`.
  - `sadasend.inbound.parse()`: Extracts token-optimized clean Markdown, strips signatures and quoted reply histories (~85% token reduction), and tags prompt-injection risk score (0.0 to 1.0) with quarantine recommendations.
  - `sadasend.inbound.simulate()`: Tests routing rules against incoming recipient addresses.
- **DMARC Deliverability Radar & Forensic Reporting (`client.dmarc`)**:
  - `sadasend.dmarc.reports`: `list()`, `create()`, `get()`.
  - `sadasend.dmarc.summary(domain)`: Returns deliverability scorecard, pass rates, SPF/DKIM alignment, and policy recommendations.
  - `sadasend.dmarc.threats()`: Lists unauthorized spoofing sources.
- **Multi-Agent Collision Arbiter & Cooldowns (`client.arbiter`)**:
  - `sadasend.arbiter.stats()`: Global collision statistics.
  - `sadasend.arbiter.cooldowns`: `set()`, `clear()`, `status()`.
  - `sadasend.arbiter.tickets`: `create()`, `delete()`.
- **Multi-Agent Ephemeral Inboxes (`client.inboxes`)**:
  - `sadasend.inboxes.create()` / `createEphemeral()`: Dynamic temporary inboxes in under 10ms with automatic TTL expiration.
  - `sadasend.inboxes.otp()`: Reactive stream extracting 2FA verification codes without polling loops.
  - `sadasend.inboxes.messages()`, `sadasend.inboxes.stream()`, `sadasend.inboxes.inbound()`.
- **E2E Testing Sandbox (`client.testing`)**:
  - `sadasend.testing.inbound()`, `sadasend.testing.waitForCode()`, `sadasend.testing.inboxes.code()`, `sadasend.testing.inboxes.latest()`.
- **Message Provenance & Hold Types**:
  - Added typed `provenance` (`channel`, `source`, `agentName`, `priority`) to `SendInput` and `Message`.
  - Added `holdType?: 'tenant' | 'security' | null` to `Message` and `SendResult`.
- **Slack Integration**:
  - Added `sadasend.integrations.slack()` status check.

### Removed
- Removed billing client operations and Paddle checkout (`client.billing`).

## [0.1.1] - 2026-10-24

### Added
- **Deliverability Shield & Verification**:
  - Added `verifyBeforeSend?: boolean` (and `verify_before_send`) to `SendInput` for `sadasend.emails.send(...)` and `sadasend.emails.batch(...)` to perform pre-send deliverability checks without burning quota.
  - Added `sadasend.tools.verify(email)` and `sadasend.tools.verifyBatch(emails)` returning typed `VerificationResult` and `BatchVerificationResult`.
- **RFC 8058 One-Click Header**:
  - Added `marketing?: boolean` to `SendInput` to automatically inject `List-Unsubscribe` and `List-Unsubscribe-Post` headers.
- **Typed Guardrail Error Classes**:
  - Added typed error classes: `UndeliverableRecipientError`, `InvalidSubjectError`, `InvalidDateError`, `BatchSizeExceededError`, `PlanTierInsufficientError`, `AnonymousLimitExceededError`, `InvitationAlreadyPendingError`, and `InvalidPlanError`.
- **UTM Campaign Tracking & Parameter Normalization**:
  - Added native `utm?: UtmOptions` support to `SendInput` for `sadasend.emails.send(...)` and `sadasend.emails.batch(...)` (`source`, `medium`, `campaign`, `term`, `content`, `override_existing`).
  - Added `sadasend.tools.buildUtm(options)` method (`POST /tools/utm`) returning typed `UtmBuildResult`.

## [0.1.0] - 2026-10-10

### Added
- Official zero-dependency TypeScript/JavaScript SDK published on npm.
- Discriminated union returns (`Result<T, E>`), automatic retry with full jitter, built-in idempotency, and WebCrypto webhook verification.
