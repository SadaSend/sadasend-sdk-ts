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
    const isSse = res.headers?.["content-type"] === "text/event-stream";
    return new Response(res.body === undefined ? "" : isSse ? String(res.body) : JSON.stringify(res.body), {
      status: res.status,
      headers: { "content-type": isSse ? "text/event-stream" : "application/json", ...res.headers },
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
      if (url.endsWith("/templates/tmpl_1/test") && method === "POST") {
        return { status: 200, body: { ok: true, messageId: "msg_test_tpl_1" } };
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

    const tTest = await sdk.templates.test("tmpl_1", { to: "alice@example.com" });
    expect(tTest.ok).toBe(true);
    if (tTest.ok) expect(tTest.data.messageId).toBe("msg_test_tpl_1");

    expect(calls.length).toBe(4);
  });

  test("keys, support, team, tools, webhooks", async () => {
    const { sdk, calls } = createMockClient((url, method) => {
      if (url.endsWith("/keys") && method === "GET") {
        return { status: 200, body: { keys: [{ id: "k1", name: "Agent Key" }] } };
      }
      if (url.endsWith("/keys/approvals") && method === "GET") {
        return { status: 200, body: { pending: [] } };
      }
      if (url.includes("/support/tickets/t1") && method === "GET") {
        return { status: 200, body: { id: "t1", subject: "Help", status: "open" } };
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
      if (url.endsWith("/tools/dns") && method === "POST") {
        return { status: 200, body: { tool: "dns", verdict: "pass" } };
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

    const sTicket = await sdk.support.ticket("t1");
    expect(sTicket.ok).toBe(true);
    if (sTicket.ok) expect(sTicket.data.id).toBe("t1");

    const team = await sdk.team.get();
    expect(team.ok).toBe(true);

    const tools = await sdk.tools.list();
    expect(tools.ok).toBe(true);

    const toolCheck = await sdk.tools.check("dns", "acme.com");
    expect(toolCheck.ok).toBe(true);
    if (toolCheck.ok) expect(toolCheck.data.verdict).toBe("pass");

    const whList = await sdk.webhooks.list();
    expect(whList.ok).toBe(true);

    const whDeliv = await sdk.webhooks.deliveries("wh_1");
    expect(whDeliv.ok).toBe(true);

    expect(calls.length).toBe(9);
  });

  test("inbound: routes, messages, parse, simulate", async () => {
    const { sdk, calls } = createMockClient((url, method, body) => {
      if (url.endsWith("/inbound/routes") && method === "GET") {
        return { status: 200, body: { routes: [{ id: "rt_1", pattern: "*@inbound.acme.com", targetUrl: "https://hook.acme.com" }], count: 1 } };
      }
      if (url.endsWith("/inbound/routes") && method === "POST") {
        return { status: 201, body: { ok: true, route: { id: "rt_new", pattern: body.pattern, targetUrl: body.targetUrl } } };
      }
      if (url.endsWith("/inbound/routes/rt_1") && method === "GET") {
        return { status: 200, body: { ok: true, route: { id: "rt_1" } } };
      }
      if (url.endsWith("/inbound/routes/rt_1") && method === "PATCH") {
        return { status: 200, body: { ok: true, route: { id: "rt_1", enabled: body.enabled } } };
      }
      if (url.endsWith("/inbound/routes/rt_1") && method === "DELETE") {
        return { status: 200, body: { ok: true, id: "rt_1", deleted: true } };
      }
      if (url.includes("/inbound/messages?") && method === "GET") {
        return { status: 200, body: { messages: [{ id: "in_1", from: "sender@test.com" }], count: 1 } };
      }
      if (url.endsWith("/inbound/messages/in_1") && method === "GET") {
        return { status: 200, body: { ok: true, message: { id: "in_1" } } };
      }
      if (url.endsWith("/inbound/parse") && method === "POST") {
        return {
          status: 200,
          body: {
            ok: true,
            quarantined: false,
            content: { cleanMarkdown: "Hello from client", hasQuotedHistory: false, hasSignature: false },
            security: { injectionRiskScore: 0.05, riskLevel: "clean", recommendedAction: "pass", quarantineRecommended: false, hiddenContentDetected: false, detections: [] },
          },
        };
      }
      if (url.endsWith("/inbound/simulate") && method === "POST") {
        return { status: 200, body: { matched: true, targetUrl: "https://hook.acme.com" } };
      }
      return { status: 404, body: { error: "not_found" } };
    });

    const routesList = await sdk.inbound.routes.list();
    expect(routesList.ok).toBe(true);
    if (routesList.ok) expect(routesList.data.routes.length).toBe(1);

    const routeCreate = await sdk.inbound.routes.create({ pattern: "*@inbound.acme.com", targetUrl: "https://hook.acme.com" });
    expect(routeCreate.ok).toBe(true);

    const routeGet = await sdk.inbound.routes.get("rt_1");
    expect(routeGet.ok).toBe(true);

    const routeUpdate = await sdk.inbound.routes.update("rt_1", { enabled: false });
    expect(routeUpdate.ok).toBe(true);

    const routeDelete = await sdk.inbound.routes.delete("rt_1");
    expect(routeDelete.ok).toBe(true);

    const msgsList = await sdk.inbound.messages.list({ limit: 10 });
    expect(msgsList.ok).toBe(true);

    const msgGet = await sdk.inbound.messages.get("in_1");
    expect(msgGet.ok).toBe(true);

    const parseRes = await sdk.inbound.parse({ subject: "Test", text: "Hello" });
    expect(parseRes.ok).toBe(true);
    if (parseRes.ok) expect(parseRes.data.content.cleanMarkdown).toBe("Hello from client");

    const simRes = await sdk.inbound.simulate("agent@inbound.acme.com");
    expect(simRes.ok).toBe(true);

    expect(calls.length).toBe(9);
  });

  test("dmarc: reports, summary, threats", async () => {
    const { sdk, calls } = createMockClient((url, method) => {
      if (url.endsWith("/dmarc/reports/rep_1") && method === "GET") {
        return { status: 200, body: { ok: true, report: { id: "rep_1", domain: "acme.com" } } };
      }
      if (url.endsWith("/dmarc/reports") && method === "POST") {
        return { status: 201, body: { ok: true, id: "rep_uploaded" } };
      }
      if (url.includes("/dmarc/reports") && method === "GET") {
        return { status: 200, body: { reports: [{ id: "rep_1", domain: "acme.com" }], count: 1 } };
      }
      if (url.endsWith("/dmarc/domains/acme.com/summary") && method === "GET") {
        return { status: 200, body: { domain: "acme.com", dkimAlignmentPct: 100, spfAlignmentPct: 100, currentPolicy: "reject", recommendedPolicy: "reject" } };
      }
      if (url.endsWith("/dmarc/threats") && method === "GET") {
        return { status: 200, body: { ok: true, threats: [{ ip: "1.2.3.4", count: 10 }] } };
      }
      return { status: 404, body: { error: "not_found" } };
    });

    const repList = await sdk.dmarc.reports.list({ domain: "acme.com" });
    expect(repList.ok).toBe(true);

    const repCreate = await sdk.dmarc.reports.create("<feedback></feedback>");
    expect(repCreate.ok).toBe(true);

    const repGet = await sdk.dmarc.reports.get("rep_1");
    expect(repGet.ok).toBe(true);
    if (repGet.ok) expect(repGet.data.report.id).toBe("rep_1");

    const summary = await sdk.dmarc.summary("acme.com");
    expect(summary.ok).toBe(true);
    if (summary.ok) expect(summary.data.dkimAlignmentPct).toBe(100);

    const threats = await sdk.dmarc.threats();
    expect(threats.ok).toBe(true);

    expect(calls.length).toBe(5);
  });

  test("arbiter: stats, cooldowns, tickets", async () => {
    const { sdk, calls } = createMockClient((url, method) => {
      if (url.endsWith("/arbiter/stats") && method === "GET") {
        return { status: 200, body: { ok: true, activeCooldownsCount: 2, openTicketsCount: 0, collisionsPrevented: 15 } };
      }
      if (url.includes("/arbiter/recipients/lead%40corp.com/cooldown") && method === "POST") {
        return { status: 200, body: { ok: true, cooldown: true, recipient: "lead@corp.com", durationSeconds: 86400, expiresAt: "2026-10-31T00:00:00Z" } };
      }
      if (url.includes("/arbiter/recipients/lead%40corp.com/cooldown") && method === "DELETE") {
        return { status: 200, body: { ok: true, recipient: "lead@corp.com", cleared: true } };
      }
      if (url.includes("/arbiter/recipients/lead%40corp.com/status") && method === "GET") {
        return { status: 200, body: { ok: true, recipient: "lead@corp.com", cooldownActive: false, remainingSeconds: 0 } };
      }
      if (url.endsWith("/arbiter/tickets") && method === "POST") {
        return { status: 200, body: { ok: true, recipient: "lead@corp.com", ticketId: "tkt_1" } };
      }
      if (url.includes("/arbiter/tickets/lead%40corp.com") && method === "DELETE") {
        return { status: 200, body: { ok: true, recipient: "lead@corp.com", resolved: true } };
      }
      return { status: 404, body: { error: "not_found" } };
    });

    const stats = await sdk.arbiter.stats();
    expect(stats.ok).toBe(true);
    if (stats.ok) expect(stats.data.collisionsPrevented).toBe(15);

    const cdSet = await sdk.arbiter.cooldowns.set("lead@corp.com", 86400, "Outreach");
    expect(cdSet.ok).toBe(true);

    const cdClear = await sdk.arbiter.cooldowns.clear("lead@corp.com");
    expect(cdClear.ok).toBe(true);

    const cdStatus = await sdk.arbiter.cooldowns.status("lead@corp.com");
    expect(cdStatus.ok).toBe(true);

    const tktCreate = await sdk.arbiter.tickets.create("lead@corp.com", "Support open");
    expect(tktCreate.ok).toBe(true);

    const tktDelete = await sdk.arbiter.tickets.delete("lead@corp.com");
    expect(tktDelete.ok).toBe(true);

    expect(calls.length).toBe(6);
  });

  test("inboxes: list, get, delete, create, otp, messages, stream, inbound", async () => {
    const { sdk, calls } = createMockClient((url, method) => {
      if (url.endsWith("/inboxes") && method === "GET") {
        return { status: 200, body: { ok: true, count: 1, inboxes: [{ id: "inb_1", email: "agent@auth.sadasend.com" }] } };
      }
      if (url.endsWith("/inboxes/ephemeral") && method === "POST") {
        return { status: 201, body: { ok: true, inbox: { id: "inb_1", email: "agent@auth.sadasend.com", ttlSeconds: 600 } } };
      }
      if (url.endsWith("/inboxes/inb_1") && method === "GET") {
        return { status: 200, body: { ok: true, inbox: { id: "inb_1" } } };
      }
      if (url.endsWith("/inboxes/inb_1") && method === "DELETE") {
        return { status: 200, body: { ok: true, id: "inb_1", deleted: true } };
      }
      if (url.includes("/inboxes/inb_1/otp") && method === "GET") {
        return { status: 200, body: { ok: true, inboxId: "inb_1", email: "agent@auth.sadasend.com", code: "749201" } };
      }
      if (url.endsWith("/inboxes/inb_1/messages") && method === "GET") {
        return { status: 200, body: { ok: true, messages: [{ id: "m1", subject: "Verification code" }] } };
      }
      if (url.endsWith("/inboxes/inb_1/stream") && method === "GET") {
        return {
          status: 200,
          headers: { "content-type": "text/event-stream" },
          body: "event: connected\ndata: {\"ok\":true,\"inboxId\":\"inb_1\",\"email\":\"agent@auth.sadasend.com\",\"expiresAt\":\"2026-11-05T00:00:00Z\"}\n\n",
        };
      }
      if (url.endsWith("/inboxes/inbound") && method === "POST") {
        return { status: 201, body: { ok: true, otp: "749201", magicLink: null } };
      }
      return { status: 404, body: { error: "not_found" } };
    });

    const inbList = await sdk.inboxes.list();
    expect(inbList.ok).toBe(true);

    const inbCreate = await sdk.inboxes.create({ ttlSeconds: 600, alias: "agent-test" });
    expect(inbCreate.ok).toBe(true);

    const inbCreateEphemeral = await sdk.inboxes.createEphemeral({ ttlSeconds: 300 });
    expect(inbCreateEphemeral.ok).toBe(true);

    const inbGet = await sdk.inboxes.get("inb_1");
    expect(inbGet.ok).toBe(true);

    const inbOtp = await sdk.inboxes.otp("inb_1", { waitFor: true, timeoutMs: 5000 });
    expect(inbOtp.ok).toBe(true);
    if (inbOtp.ok) expect(inbOtp.data.code).toBe("749201");

    const inbMsgs = await sdk.inboxes.messages("inb_1");
    expect(inbMsgs.ok).toBe(true);

    expect(sdk.inboxes.streamUrl("inb_1")).toBe("http://api.test/inboxes/inb_1/stream");

    const inbStream = await sdk.inboxes.stream("inb_1");
    expect(inbStream.ok).toBe(true);
    if (inbStream.ok) {
      expect(inbStream.data.url).toContain("/inboxes/inb_1/stream");
      const events: any[] = [];
      for await (const evt of inbStream.data) {
        events.push(evt);
      }
      expect(events.length).toBe(1);
      expect(events[0].event).toBe("connected");
      expect(events[0].data.inboxId).toBe("inb_1");
    }

    const inbInbound = await sdk.inboxes.inbound({ to: "agent@auth.sadasend.com", subject: "Code", text: "Your code is 749201" });
    expect(inbInbound.ok).toBe(true);

    const inbDelete = await sdk.inboxes.delete("inb_1");
    expect(inbDelete.ok).toBe(true);

    expect(calls.length).toBe(9);
  });

  test("testing & integrations: inbound, waitForCode, inboxes, slack", async () => {
    const { sdk, calls } = createMockClient((url, method) => {
      if (url.endsWith("/testing/inbound") && method === "POST") {
        return { status: 200, body: { ok: true, status: "ingested", id: "tst_1" } };
      }
      if (url.endsWith("/testing/wait-for-code") && method === "POST") {
        return { status: 200, body: { ok: true, otp: "852963", magicLink: null } };
      }
      if (url.includes("/testing/inboxes/tst%40test.com/code") && method === "GET") {
        return { status: 200, body: { ok: true, otp: "852963" } };
      }
      if (url.includes("/testing/inboxes/tst%40test.com/latest") && method === "GET") {
        return { status: 200, body: { ok: true, message: { id: "m1" } } };
      }
      if (url.endsWith("/integrations/slack") && method === "GET") {
        return { status: 200, body: { connected: true, integration: { id: "slk_1", channel: "slack", name: "Slack", enabled: true } } };
      }
      return { status: 404, body: { error: "not_found" } };
    });

    const tInbound = await sdk.testing.inbound({ to: "tst@test.com", subject: "Verify", text: "Code: 852963" });
    expect(tInbound.ok).toBe(true);

    const tWait = await sdk.testing.waitForCode({ to: "tst@test.com", timeoutMs: 10000 });
    expect(tWait.ok).toBe(true);
    if (tWait.ok) {
      expect(tWait.data.code).toBe("852963");
      expect(tWait.data.otp).toBe("852963");
    }

    const tCode = await sdk.testing.inboxes.code("tst@test.com");
    expect(tCode.ok).toBe(true);
    if (tCode.ok) {
      expect(tCode.data.code).toBe("852963");
      expect(tCode.data.otp).toBe("852963");
    }

    const tLatest = await sdk.testing.inboxes.latest("tst@test.com");
    expect(tLatest.ok).toBe(true);

    const slack = await sdk.integrations.slack();
    expect(slack.ok).toBe(true);
    if (slack.ok) expect(slack.data.connected).toBe(true);

    expect(calls.length).toBe(5);
  });
});
