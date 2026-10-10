import { describe, expect, test } from "bun:test";
import { SadaSend } from "../src/client.js";

type Scripted = { status: number; body?: unknown; headers?: Record<string, string> };

function createMockClient(handler: (url: string, method: string, body?: any) => Scripted) {
  const calls: { url: string; method: string; body?: any; headers?: Record<string, string> }[] = [];
  const fn = (async (url: string | URL | Request, init: RequestInit = {}) => {
    const rawBody = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({
      url: String(url),
      method: init.method || "GET",
      body: rawBody,
      headers: (init.headers as Record<string, string>) || {},
    });
    const res = handler(String(url), init.method || "GET", rawBody);
    return new Response(res.body === undefined ? "" : JSON.stringify(res.body), {
      status: res.status,
      headers: { "content-type": "application/json", ...res.headers },
    });
  }) as unknown as typeof globalThis.fetch;

  const sdk = new SadaSend("sada_live_sk_resource_test", {
    baseUrl: "http://api.test",
    fetch: fn,
  });

  return { sdk, calls };
}

describe("Full Resource API Surface Coverage", () => {
  test("emails: get, list, resend, cancel, batch", async () => {
    const { sdk, calls } = createMockClient((url, method) => {
      if (url.endsWith("/emails/msg_123") && method === "GET") {
        return { status: 200, body: { id: "msg_123", status: "delivered", to: ["recipient@example.com"] } };
      }
      if (url.includes("/emails?") && method === "GET") {
        return { status: 200, body: { messages: [{ id: "msg_1" }], total: 1 } };
      }
      if (url.endsWith("/emails/msg_123/resend") && method === "POST") {
        return { status: 202, body: { id: "msg_new", status: "queued" } };
      }
      if (url.endsWith("/emails/msg_123") && method === "DELETE") {
        return { status: 200, body: { id: "msg_123", status: "cancelled" } };
      }
      if (url.endsWith("/emails/batch") && method === "POST") {
        return { status: 207, body: { total: 1, accepted: 1, refused: 0, results: [{ ok: true, id: "m1", index: 0 }] } };
      }
      return { status: 404, body: { error: "not_found" } };
    });

    // 1. emails.get
    const getRes = await sdk.emails.get("msg_123");
    expect(getRes.ok).toBe(true);
    if (getRes.ok) expect(getRes.data.id).toBe("msg_123");

    // 2. emails.list
    const listRes = await sdk.emails.list({ limit: 10, status: "sent", channel: "api" });
    expect(listRes.ok).toBe(true);
    if (listRes.ok) expect(listRes.data.messages.length).toBe(1);

    // 3. emails.resend
    const resendRes = await sdk.emails.resend("msg_123");
    expect(resendRes.ok).toBe(true);
    if (resendRes.ok) expect(resendRes.data.id).toBe("msg_new");

    // 4. emails.cancel
    const cancelRes = await sdk.emails.cancel("msg_123");
    expect(cancelRes.ok).toBe(true);
    if (cancelRes.ok) expect(cancelRes.data.status).toBe("cancelled");

    // 5. emails.batch
    const batchRes = await sdk.emails.batch([{ from: "a@b.com", to: "c@d.com", subject: "hi", text: "there" }]);
    expect(batchRes.ok).toBe(true);
    if (batchRes.ok) expect(batchRes.data.accepted).toBe(1);

    expect(calls.length).toBe(5);
  });

  test("account: get, stats, volume, checklist, circuitBreakers, staffAccess", async () => {
    const { sdk, calls } = createMockClient((url) => {
      if (url.endsWith("/account")) {
        return { status: 200, body: { id: "acc_1", org: "Acme", plan: "pro", emailsUsed: 50, emailQuota: 50000 } };
      }
      if (url.includes("/account/stats")) {
        return { status: 200, body: { sent: 100, delivered: 98, bounced: 2 } };
      }
      if (url.includes("/account/volume")) {
        return { status: 200, body: { days: [{ date: "2026-10-10", sent: 10 }] } };
      }
      if (url.endsWith("/account/checklist")) {
        return { status: 200, body: { items: [{ name: "domain_verified", complete: true }] } };
      }
      if (url.endsWith("/account/circuit-breakers")) {
        return { status: 200, body: { breakers: [] } };
      }
      if (url.endsWith("/account/staff-access")) {
        return { status: 200, body: { logs: [] } };
      }
      return { status: 404, body: { error: "not_found" } };
    });

    const acc = await sdk.account.get();
    expect(acc.ok).toBe(true);
    if (acc.ok) expect(acc.data.plan).toBe("pro");

    const stats = await sdk.account.stats({ window: "7d" });
    expect(stats.ok).toBe(true);
    if (stats.ok) expect(stats.data.sent).toBe(100);

    const vol = await sdk.account.volume({ window: "14d" });
    expect(vol.ok).toBe(true);

    const chk = await sdk.account.checklist();
    expect(chk.ok).toBe(true);

    const cb = await sdk.account.circuitBreakers();
    expect(cb.ok).toBe(true);

    const sa = await sdk.account.staffAccess();
    expect(sa.ok).toBe(true);

    expect(calls.length).toBe(6);
  });

  test("domains: list, records, verify", async () => {
    const { sdk, calls } = createMockClient((url, method) => {
      if (url.endsWith("/domains") && method === "GET") {
        return { status: 200, body: { domains: [{ id: "dom_1", name: "acme.com", status: "verified" }] } };
      }
      if (url.endsWith("/domains/dom_1/records") && method === "GET") {
        return { status: 200, body: { records: [{ type: "TXT", host: "sada._domainkey", value: "v=DKIM1..." }] } };
      }
      if (url.endsWith("/domains/dom_1/verify") && method === "POST") {
        return { status: 200, body: { id: "dom_1", status: "verified" } };
      }
      return { status: 404, body: { error: "not_found" } };
    });

    const dList = await sdk.domains.list();
    expect(dList.ok).toBe(true);
    if (dList.ok) expect(dList.data.domains[0]!.name).toBe("acme.com");

    const dRecs = await sdk.domains.records("dom_1");
    expect(dRecs.ok).toBe(true);
    if (dRecs.ok) expect(dRecs.data.records[0]!.type).toBe("TXT");

    const dVer = await sdk.domains.verify("dom_1");
    expect(dVer.ok).toBe(true);
    if (dVer.ok) expect(dVer.data.status).toBe("verified");

    expect(calls.length).toBe(3);
  });

  test("suppressions: list, add", async () => {
    const { sdk, calls } = createMockClient((url, method, body) => {
      if (url.includes("/suppressions") && method === "GET") {
        return { status: 200, body: { suppressions: [{ address: "bad@example.com", reason: "hard_bounce" }] } };
      }
      if (url.endsWith("/suppressions") && method === "POST") {
        return { status: 201, body: { address: body?.address, reason: body?.reason } };
      }
      return { status: 404, body: { error: "not_found" } };
    });

    const sList = await sdk.suppressions.list({ q: "bad" });
    expect(sList.ok).toBe(true);
    if (sList.ok) expect(sList.data.suppressions[0]!.address).toBe("bad@example.com");

    const sAdd = await sdk.suppressions.add("optout@example.com", "unsubscribe");
    expect(sAdd.ok).toBe(true);
    if (sAdd.ok) expect(sAdd.data.address).toBe("optout@example.com");

    expect(calls.length).toBe(2);
  });

  test("templates: list, get, render", async () => {
    const { sdk, calls } = createMockClient((url, method) => {
      if (url.endsWith("/templates") && method === "GET") {
        return { status: 200, body: { templates: [{ id: "tmpl_1", name: "Welcome" }] } };
      }
      if (url.endsWith("/templates/tmpl_1") && method === "GET") {
        return { status: 200, body: { id: "tmpl_1", name: "Welcome", html: "<h1>Hi {{ name }}</h1>" } };
      }
      if (url.endsWith("/templates/tmpl_1/render") && method === "POST") {
        return { status: 200, body: { html: "<h1>Hi Alice</h1>", text: "Hi Alice" } };
      }
      return { status: 404, body: { error: "not_found" } };
    });

    const tList = await sdk.templates.list();
    expect(tList.ok).toBe(true);

    const tGet = await sdk.templates.get("tmpl_1");
    expect(tGet.ok).toBe(true);

    const tRender = await sdk.templates.render("tmpl_1", { name: "Alice" });
    expect(tRender.ok).toBe(true);
    if (tRender.ok) expect(tRender.data.html).toBe("<h1>Hi Alice</h1>");

    expect(calls.length).toBe(3);
  });

  test("keys, support, team, tools, webhooks", async () => {
    const { sdk, calls } = createMockClient((url, method) => {
      if (url.endsWith("/keys") && method === "GET") {
        return { status: 200, body: { keys: [{ id: "k1", name: "Agent Key" }] } };
      }
      if (url.endsWith("/keys/approvals") && method === "GET") {
        return { status: 200, body: { pending: [] } };
      }
      if (url.includes("/support/tickets") && method === "GET") {
        return { status: 200, body: { tickets: [{ id: "t1", subject: "Help" }] } };
      }
      if (url.endsWith("/team") && method === "GET") {
        return { status: 200, body: { members: [{ email: "dev@acme.com", role: "owner" }] } };
      }
      if (url.endsWith("/tools") && method === "GET") {
        return { status: 200, body: { tools: ["dns", "spf", "dkim"] } };
      }
      if (url.endsWith("/webhooks") && method === "GET") {
        return { status: 200, body: { webhooks: [{ id: "wh_1", url: "https://hook.acme.com" }] } };
      }
      if (url.includes("/webhooks/wh_1/deliveries") && method === "GET") {
        return { status: 200, body: { deliveries: [{ id: "del_1", status: "success" }] } };
      }
      return { status: 404, body: { error: "not_found" } };
    });

    const kList = await sdk.keys.list();
    expect(kList.ok).toBe(true);

    const kAppr = await sdk.keys.approvals();
    expect(kAppr.ok).toBe(true);

    const sTickets = await sdk.support.tickets();
    expect(sTickets.ok).toBe(true);

    const team = await sdk.team.get();
    expect(team.ok).toBe(true);

    const tools = await sdk.tools.list();
    expect(tools.ok).toBe(true);

    const whList = await sdk.webhooks.list();
    expect(whList.ok).toBe(true);

    const whDeliv = await sdk.webhooks.deliveries("wh_1");
    expect(whDeliv.ok).toBe(true);

    expect(calls.length).toBe(7);
  });
});
