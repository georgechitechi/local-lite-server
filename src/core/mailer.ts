import type { SmtpSettings } from '../config.js';

/** Sends a plain-text email via SMTP (lazy-loads nodemailer only when called). */
export async function sendSmtpMail(
  smtp: SmtpSettings,
  to: string,
  subject: string,
  text: string,
): Promise<void> {
  const nodemailer: any = await import('nodemailer');
  const transport = (nodemailer.default ?? nodemailer).createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
  });
  await transport.sendMail({ from: smtp.from, to, subject, text });
}
