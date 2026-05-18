import { FROM_EMAIL } from './config.mjs';

// Email delivery is temporarily stubbed.
//
// The original implementation sent mail through AWS SES, but the AWS account
// behind it was decommissioned during the GCP migration. Until a replacement
// provider is wired up, sendEmail() is a no-op that logs what *would* have been
// sent so the API and chain watcher can run end-to-end without a mail backend.
//
// To re-enable email, replace the body of sendEmail() with a real provider
// (Resend, SMTP via nodemailer, SES on a live account, ...) and return its
// message id on success / null on failure. No other module needs to change.
const EMAIL_ENABLED = false;

/**
 * Send an HTML email. Currently a logged no-op (see note above).
 * Returns a message id on success, or null on failure / when disabled.
 */
export async function sendEmail(to, subject, _htmlBody) {
  if (!EMAIL_ENABLED) {
    console.warn(
      `[mailer] email disabled — skipped send from=${FROM_EMAIL} to=${to} subject=${JSON.stringify(subject)}`
    );
    return null;
  }
  return null;
}
