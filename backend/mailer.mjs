import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { FROM_EMAIL, SES_REGION } from './config.mjs';

const ses = new SESClient({ region: SES_REGION });

/**
 * Send an HTML email via AWS SES.
 * Returns the SES MessageId on success, or null on failure.
 */
export async function sendEmail(to, subject, htmlBody) {
  try {
    const cmd = new SendEmailCommand({
      Source: FROM_EMAIL,
      Destination: { ToAddresses: [to] },
      Message: {
        Subject: { Data: subject, Charset: 'UTF-8' },
        Body: {
          Html: { Data: htmlBody, Charset: 'UTF-8' },
          Text: { Data: htmlBody.replace(/<[^>]+>/g, ''), Charset: 'UTF-8' },
        },
      },
    });
    const res = await ses.send(cmd);
    return res.MessageId || null;
  } catch (err) {
    console.error('[mailer] SES send failed:', err.message);
    return null;
  }
}
