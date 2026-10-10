// bun add sadasend
import { SadaSend } from 'sadasend';

const sadasend = new SadaSend(process.env.SADASEND_API_KEY);

const result = await sadasend.emails.send({
  from: 'noreply@onboarding.sadasend.com',
  to: 'dana@example.com',
  subject: 'It works.',
  html: '<strong>Sent from the SadaSend SDK.</strong>',
});

if (!result.ok) throw new Error(result.error.message);
console.log(result.status, result.id);
