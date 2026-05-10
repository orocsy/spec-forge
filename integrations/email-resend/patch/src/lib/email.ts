/**
 * Resend transactional email — singleton client + typed helper.
 *
 * Free tier: 3000 emails/mo + 1 custom domain.
 * Get a key: https://resend.com/api-keys
 *
 * Example:
 *   await sendEmail({
 *     to: 'user@example.com',
 *     subject: 'Welcome',
 *     html: '<p>Hello</p>',
 *   });
 */
import { Resend } from 'resend';

let _client: Resend | null = null;

function getClient(): Resend {
  if (_client) return _client;
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    throw new Error('RESEND_API_KEY is not set — get one at https://resend.com/api-keys');
  }
  _client = new Resend(key);
  return _client;
}

export interface SendEmailInput {
  to: string | string[];
  subject: string;
  html: string;
  from?: string;
  replyTo?: string;
}

export async function sendEmail(input: SendEmailInput): Promise<{ id: string }> {
  const client = getClient();
  const from =
    input.from ?? process.env.RESEND_FROM ?? 'onboarding@resend.dev';
  const result = await client.emails.send({
    from,
    to: input.to,
    subject: input.subject,
    html: input.html,
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
  });
  if (result.error) {
    throw new Error(`Resend send failed: ${result.error.message}`);
  }
  return { id: result.data?.id ?? '' };
}
