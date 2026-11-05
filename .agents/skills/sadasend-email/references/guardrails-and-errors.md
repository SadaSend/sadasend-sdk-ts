# SadaSend Guardrails & Error Reference for AI Agents

SadaSend is engineered to prevent autonomous AI agents from hallucinating, leaking credentials, or spamming arbitrary recipients. This reference details each guardrail error, what triggers it, and how an agent can self-correct.

---

## 1. Recipient Allowlist Guardrail (`RecipientNotAllowlistedError`)

- **HTTP Status:** `403 Forbidden`
- **Error Code:** `recipient_not_allowlisted`
- **Why It Happens:** The API key was provisioned with a strict allowlist (e.g. `@internal.company.com`, `@staging.test`), and the agent attempted to send to an address outside that domain mask.
- **Payload Properties:**
  - `error.recipient`: The recipient that was rejected.
  - `error.allowlist`: Array of string patterns permitted by the key (e.g. `["@internal.company.com"]`).
- **Agent Self-Correction Strategy:**
  1. Do **not** blindly retry the same email.
  2. Read `error.allowlist` to see which domains or recipients are permitted.
  3. Inform the user or calling tool: *"Recipient `foo@external.com` is outside authorized patterns `[@internal.company.com]`. Send was blocked by server guardrails."*

---

## 2. Unverified Sending Domain (`DomainNotVerifiedError`)

- **HTTP Status:** `403 Forbidden`
- **Error Code:** `domain_not_verified`
- **Why It Happens:** The sender's domain has not completed DKIM, SPF, or DMARC DNS verification.
- **Payload Properties:**
  - `error.records`: Array of DNS records required to achieve alignment.
    ```ts
    {
      type: 'TXT',
      host: 'sadasend._domainkey.example.com',
      value: 'v=DKIM1; ...',
      verdict: 'fail' | 'pending' | 'inconclusive'
    }
    ```
- **Agent Self-Correction Strategy:**
  1. Print or pass `error.records` back to human operators or DevOps tools to publish the necessary DNS records.

---

## 3. Suppression List Guardrail (`RecipientSuppressedError`)

- **HTTP Status:** `403 Forbidden`
- **Error Code:** `recipient_suppressed`
- **Why It Happens:** The recipient previously unsubscribed, registered a spam complaint, or hard-bounced.
- **Payload Properties:**
  - `error.recipient`: The blocked address.
  - `error.reason`: `'hard_bounce' | 'complaint' | 'unsubscribe' | 'manual'`
- **Agent Self-Correction Strategy:**
  1. Never retry. Retrying suppressed emails destroys domain reputation and violates CAN-SPAM / GDPR.
  2. Mark the contact as inactive in your CRM, database, or agent state.

---

## 4. Rate Limiting (`RateLimitError`)

- **HTTP Status:** `429 Too Many Requests`
- **Error Code:** `rate_limited` or `account_throttled`
- **Payload Properties:**
  - `error.retryAfterSeconds`: Number of seconds specified by the server's `Retry-After` header.
  - `error.isAccountThrottle`: True if throttled due to global account reputation thresholds.
- **Agent Self-Correction Strategy:**
  1. The SDK automatically sleeps and retries if `retryAfterSeconds` is within `maxRetryAfterMs` (default: 60s).
  2. If the SDK surfaced the error, wait `error.retryAfterSeconds` before attempting another batch.

---

## 5. Scope Restrictions (`InsufficientScopeError`)

- **HTTP Status:** `403 Forbidden`
- **Error Code:** `insufficient_scope`
- **Why It Happens:** The API key lacks the required scope (e.g., trying to modify suppressions with a send-only key).
- **Agent Self-Correction Strategy:**
  1. Do not retry in code. An operator must elevate the key's permissions in the SadaSend dashboard.

---

## 6. Network Glitches (`ConnectionError`)

- **Type:** Exception (`throw ConnectionError`)
- **Why It Happens:** The agent lost internet connectivity, the socket timed out, or DNS failed after exhausting all retries.
- **Agent Self-Correction Strategy:**
  - Catch `ConnectionError`. Because idempotency keys are automatically attached by the SDK, retrying the operation later will not cause duplicate sends if the original request was received.

---

## 7. Deliverability Shield Refusal (`UndeliverableRecipientError`)

- **HTTP Status:** `422 Unprocessable Entity`
- **Error Code:** `undeliverable_recipient`
- **Why It Happens:** When `verifyBeforeSend: true` (or `verify_before_send`) is enabled, the server performs an instant pre-send MX, syntax, and disposable mailbox check. If the recipient domain has no MX records, the mailbox is disposable, or syntax is invalid, the send is refused immediately.
- **Key Advantage:** Debits **0** account quota and protects your sending domain reputation from hard bounces.
- **Payload Properties:**
  - `error.recipient`: The rejected recipient email address.
- **Agent Self-Correction Strategy:**
  1. Do not retry dispatching to this email address.
  2. Flag the recipient record in your agent state/database as invalid or undeliverable.

---

## 8. Subject Formatting & Injection Defense (`InvalidSubjectError`)

- **HTTP Status:** `400 Bad Request`
- **Error Code:** `invalid_subject`
- **Why It Happens:** The subject is empty or contains CRLF (`\r`, `\n`) control characters that could facilitate email header injection.
- **Agent Self-Correction Strategy:**
  1. Sanitize subject text: strip out `\r` and `\n` characters before resubmitting.

---

## 9. Scheduling Window Constraints (`InvalidDateError`)

- **HTTP Status:** `400 Bad Request`
- **Error Code:** `invalid_date`
- **Why It Happens:** `scheduledAt` is formatted incorrectly, in the past, or set more than 72 hours in advance.
- **Agent Self-Correction Strategy:**
  1. Ensure `scheduledAt` is a valid JavaScript `Date` or ISO string between 5 minutes and 72 hours from the current UTC timestamp.

---

## 10. Plan Tiers & Batch Boundaries (`PlanTierInsufficientError`, `BatchSizeExceededError`)

- **HTTP Status:** `403 Forbidden` (`plan_tier_insufficient`) / `400 Bad Request` (`batch_size_exceeded`)
- **Why It Happens:** Attempting to access an enterprise/scale feature or sending a batch larger than permitted.
- **Agent Self-Correction Strategy:**
  1. For batch errors, split items into smaller chunks (<= 100 per request).
  2. For tier errors, notify the human supervisor that plan elevation is required.

---

## 11. Volume Surge Anomaly & Security Hold (`held: true, holdType: 'security'`)

- **Response Status:** `status: 'pending_approval'`, `held: true`
- **Why It Happens:** The sender or agent triggered the adaptive volume surge detector (projected daily velocity exceeds safety multiplier, e.g. 3x 7-day baseline) or a security hold policy.
- **Payload Properties:**
  - `result.held`: `true`
  - `result.holdType`: `'security'`
  - `result.holdReason`: Detailed explanation (e.g. *"Volume surge anomaly detected: projected daily volume (3,500) exceeds safety threshold (3,000, 3x 7-day baseline). Held for operator review."*)
- **Agent Self-Correction Strategy:**
  1. Do **not** treat this as a failure or network glitch.
  2. The message has been safely accepted and placed in the Human Approval Queue.
  3. Inform the user or supervisor that the message is held pending operator review due to the reason in `result.holdReason`.
