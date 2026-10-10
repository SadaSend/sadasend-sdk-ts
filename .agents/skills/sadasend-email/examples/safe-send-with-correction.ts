import { SadaSend, RecipientNotAllowlistedError, RecipientSuppressedError, DomainNotVerifiedError } from 'sadasend';

/**
 * Autonomous AI Agent Execution Pattern
 * Demonstrates:
 *   1. Attribution & Client Setup
 *   2. Preflight Dry Run
 *   3. Guardrail Interception & Self-Correction
 *   4. Handling Approval Queue ('pending_approval')
 */
export async function agentEmailWorkflow(targetRecipient: string) {
  const client = new SadaSend(process.env.SADASEND_API_KEY, {
    agentName: 'customer-onboarding-agent',
    source: 'agent',
    channel: 'sdk',
  });

  console.log(`🤖 Agent analyzing email to: ${targetRecipient}...`);

  // Step 1: Preflight Dry Run
  const preflight = await client.emails.send({
    from: 'welcome@onboarding.sadasend.com',
    to: targetRecipient,
    subject: 'Welcome to our platform',
    text: 'Your account is now ready.',
    dryRun: true,
  });

  if (!preflight.ok) {
    const error = preflight.error;

    if (error instanceof RecipientNotAllowlistedError) {
      console.warn(`⚠️ Blocked by Agent Allowlist Guardrail!`);
      console.warn(`Target "${error.recipient}" is outside authorized patterns:`, error.allowlist);
      return { status: 'refused', reason: 'outside_allowlist', authorizedPatterns: error.allowlist };
    }

    if (error instanceof RecipientSuppressedError) {
      console.warn(`⚠️ Target recipient is suppressed (${error.reason}). Aborting send.`);
      return { status: 'refused', reason: 'suppressed', suppressionReason: error.reason };
    }

    if (error instanceof DomainNotVerifiedError) {
      console.error(`❌ Sending domain is not verified! DNS records required:`, error.records);
      return { status: 'refused', reason: 'domain_unverified', records: error.records };
    }

    console.error(`❌ Preflight failed: [${error.code}] ${error.message}`);
    return { status: 'failed', error: error.message };
  }

  console.log('✅ Preflight deliverability checks passed.');

  // Step 2: Live Dispatch with Idempotency
  const send = await client.emails.send({
    from: 'welcome@onboarding.sadasend.com',
    to: targetRecipient,
    subject: 'Welcome to our platform',
    html: '<h1>Welcome!</h1><p>Your account is ready.</p>',
    text: 'Welcome! Your account is ready.',
    tags: ['onboarding', 'agent-dispatched'],
    idempotencyKey: `onboarding-${targetRecipient}-${new Date().toISOString().slice(0, 10)}`,
  });

  if (!send.ok) {
    console.error(`❌ Send failed: ${send.error.message}`);
    return { status: 'failed', error: send.error.message };
  }

  // Step 3: Handle Normal Send vs Human Approval Queue
  if (send.status === 'pending_approval') {
    console.log(`🛡️ Message queued for HUMAN APPROVAL (ID: ${send.id}).`);
    return { status: 'held_for_approval', messageId: send.id };
  }

  console.log(`🚀 Message queued for delivery (ID: ${send.id}).`);
  return { status: 'dispatched', messageId: send.id };
}
