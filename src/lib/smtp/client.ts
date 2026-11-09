import nodemailer from "nodemailer";
import { z } from "zod";
import { getSmtpConfig, SMTP_ADDRESS } from "@/lib/smtp/config";

function transport(password: string) {
  return nodemailer.createTransport({
    host: "smtp.spaceweb.ru", port: 465, secure: true,
    auth: { user: SMTP_ADDRESS, pass: password },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
    disableFileAccess: true, disableUrlAccess: true,
  });
}

export async function verifySmtp(password: string) {
  if (!password) throw new Error("smtp-not-configured");
  const client = transport(password);
  try { await client.verify(); } catch { throw new Error("smtp-connection-failed"); } finally { client.close(); }
}

const messageSchema = z.object({
  to: z.email().max(254),
  subject: z.string().min(1).max(200).refine(value => !/[\x00-\x1f\x7f]/.test(value)),
  text: z.string().min(1).max(30000),
});

// Deliberately not wired to any workflow until that workflow is specified.
export async function sendTransactionalMail(input: z.infer<typeof messageSchema>) {
  const message = messageSchema.parse(input);
  const config = await getSmtpConfig();
  if (!config.password || !config.checkedAt) throw new Error("smtp-not-configured");
  const client = transport(config.password);
  try {
    const info = await client.sendMail({ from: { name: "SIDZEN", address: SMTP_ADDRESS }, to: message.to, subject: message.subject, text: message.text, disableFileAccess: true, disableUrlAccess: true });
    if (info.rejected.length || !info.accepted.length) throw new Error("smtp-not-accepted");
  } catch { throw new Error("smtp-send-failed"); } finally { client.close(); }
}

