# Changelog

All notable changes to the `sadasend` TypeScript SDK will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
