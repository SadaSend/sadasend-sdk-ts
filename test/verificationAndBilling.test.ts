import { describe, expect, test } from "bun:test";
import { SadaSend } from "../src/client.js";
import {
  UndeliverableRecipientError,
  InvalidSubjectError,
  InvalidDateError,
  BatchSizeExceededError,
  PlanTierInsufficientError,
  AnonymousLimitExceededError,
  InvitationAlreadyPendingError,
  InvalidPlanError,
  toError,
} from "../src/errors.js";

function createMockClient(handler: (url: string, method: string, body?: any) => { status: number; body: any; headers?: Record<string, string> }) {
  const calls: { url: string; method: string; body?: any; headers?: any }[] = [];
  const mockFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body, headers: init?.headers });

    const res = handler(url, method, body);
    return new Response(JSON.stringify(res.body), {
      status: res.status,
      headers: { "content-type": "application/json", ...(res.headers ?? {}) },
    });
  };

  const sdk = new SadaSend({ apiKey: "sada_live_1234567890abcdef12345678", fetch: mockFetch as any });
  return { sdk, calls };
}

describe("Verification, Billing & Typed Guardrails", () => {
  test("emails.send passes verifyBeforeSend and marketing flags", async () => {
    const { sdk, calls } = createMockClient((url, method, body) => {
      return { status: 202, body: { id: "msg_v1", status: "queued" } };
    });

    const res = await sdk.emails.send({
      from: "hello@sadasend.com",
      to: "recipient@example.com",
      subject: "Test Send with Verification Shield",
      text: "Testing verify before send",
      verifyBeforeSend: true,
      marketing: true,
    });

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.id).toBe("msg_v1");

    expect(calls.length).toBe(1);
    expect(calls[0]!.body.verify_before_send).toBe(true);
    expect(calls[0]!.body.marketing).toBe(true);
  });

  test("tools: verify and verifyBatch", async () => {
    const { sdk, calls } = createMockClient((url, method, body) => {
      if (url.endsWith("/tools/verify") && method === "POST") {
        return {
          status: 200,
          body: {
            email: body.email,
            user: "alex",
            domain: "example.com",
            status: "deliverable",
            verdict: "pass",
            score: 95,
            checks: {
              syntax: { valid: true },
              mx: { valid: true, records: ["mail.example.com"] },
              disposable: { isDisposable: false },
              role: { isRole: false },
            },
            rows: [],
            summary: "Address is deliverable with valid MX records.",
          },
        };
      }
      if (url.endsWith("/tools/verify/batch") && method === "POST") {
        return {
          status: 200,
          body: {
            ok: true,
            total: 2,
            deliverable: 2,
            undeliverable: 0,
            disposable: 0,
            role_account: 0,
            results: [],
          },
        };
      }
      return { status: 404, body: { error: "not_found" } };
    });

    const vSingle = await sdk.tools.verify("alex@example.com");
    expect(vSingle.ok).toBe(true);
    if (vSingle.ok) {
      expect(vSingle.data.status).toBe("deliverable");
      expect(vSingle.data.score).toBe(95);
      expect(vSingle.data.checks.syntax.valid).toBe(true);
    }

    const vBatch = await sdk.tools.verifyBatch(["a@b.com", "c@d.com"]);
    expect(vBatch.ok).toBe(true);
    if (vBatch.ok) {
      expect(vBatch.data.total).toBe(2);
      expect(vBatch.data.deliverable).toBe(2);
    }

    expect(calls.length).toBe(2);
  });

  test("billing: creditsCheckout initializes checkout transaction", async () => {
    const { sdk, calls } = createMockClient((url, method, body) => {
      if (url.endsWith("/billing/credits/checkout") && method === "POST") {
        return {
          status: 200,
          body: {
            transactionId: "txn_credit_123",
            checkoutUrl: "https://sadasend.com?_ptxn=txn_credit_123",
            priceId: "pri_verify_25k",
            clientToken: "live_token_abc",
            environment: "production",
          },
        };
      }
      return { status: 404, body: { error: "not_found" } };
    });

    const res = await sdk.billing.creditsCheckout({ pack: "25k", type: "verify" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.transactionId).toBe("txn_credit_123");
      expect(res.data.checkoutUrl).toContain("txn_credit_123");
    }

    expect(calls.length).toBe(1);
    expect(calls[0]!.body.pack).toBe("25k");
    expect(calls[0]!.body.type).toBe("verify");
  });

  test("typed guardrail errors: UndeliverableRecipientError, InvalidSubjectError, InvalidDateError", () => {
    const undeliverable = toError(422, {
      error: "undeliverable_recipient",
      message: "Recipient domain has no valid MX records",
      recipient: "dead@bad-domain.invalid",
      reason: "mx_missing",
      suggestion: "dead@gmail.com",
    });

    expect(undeliverable instanceof UndeliverableRecipientError).toBe(true);
    if (undeliverable instanceof UndeliverableRecipientError) {
      expect(undeliverable.recipient).toBe("dead@bad-domain.invalid");
      expect(undeliverable.reason).toBe("mx_missing");
      expect(undeliverable.suggestion).toBe("dead@gmail.com");
    }

    const invalidSubject = toError(400, {
      error: "invalid_subject",
      message: "Subject line exceeds RFC 5322 limit of 998 characters",
    });
    expect(invalidSubject instanceof InvalidSubjectError).toBe(true);

    const invalidDate = toError(400, {
      error: "invalid_date",
      message: "scheduledAt must be an ISO 8601 string within 72 hours",
    });
    expect(invalidDate instanceof InvalidDateError).toBe(true);

    const batchSize = toError(400, {
      error: "batch_size_exceeded",
      message: "Batch send allows up to 100 emails",
    });
    expect(batchSize instanceof BatchSizeExceededError).toBe(true);

    const planTier = toError(403, {
      error: "plan_tier_insufficient",
      message: "Feature requires Pro or Scale plan",
    });
    expect(planTier instanceof PlanTierInsufficientError).toBe(true);

    const anonLimit = toError(429, {
      error: "anonymous_limit_exceeded",
      message: "Guest verification limit of 5/day reached",
    });
    expect(anonLimit instanceof AnonymousLimitExceededError).toBe(true);

    const pendingInvite = toError(409, {
      error: "invitation_already_pending",
      message: "An invitation is already pending for this address",
    });
    expect(pendingInvite instanceof InvitationAlreadyPendingError).toBe(true);

    const invalidPlan = toError(400, {
      error: "invalid_plan",
      message: "Plan not eligible for checkout",
    });
    expect(invalidPlan instanceof InvalidPlanError).toBe(true);
  });
});
