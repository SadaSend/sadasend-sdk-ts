# Changelog

All notable changes to the `sadasend` TypeScript SDK will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - 2026-10-24

### Added
- **Deliverability Shield & Verification**:
  - Added `verifyBeforeSend?: boolean` (and `verify_before_send`) to `SendInput` for `sadasend.emails.send(...)` and `sadasend.emails.batch(...)` to perform pre-send deliverability checks without burning quota.
  - Added `sadasend.tools.verify(email)` and `sadasend.tools.verifyBatch(emails)` returning typed `VerificationResult` and `BatchVerificationResult`.
- **Prepaid Credit Packs**:
  - Added `sadasend.billing.creditsCheckout({ pack, type, returnUrl })` for initializing Paddle credit pack purchases.
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
