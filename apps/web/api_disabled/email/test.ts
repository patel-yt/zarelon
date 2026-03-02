import { z } from "zod";
import type { ApiRequest, ApiResponse } from "../_lib/http.js";
import { requireAdmin } from "../_lib/server.js";
import { sendEmail } from "../_lib/email.js";

const bodySchema = z.object({
  to: z.string().email().optional(),
  subject: z.string().trim().min(1).max(200).optional(),
});

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  const admin = await requireAdmin(req);
  if (!admin) {
    res.status(403).json({ ok: false, error: "Unauthorized" });
    return;
  }

  const enabled = (process.env.ENABLE_EMAIL_TEST ?? "").trim().toLowerCase() === "true";
  if (!enabled) {
    res.status(403).json({ ok: false, error: "Unauthorized" });
    return;
  }

  if (!process.env.RESEND_API_KEY?.trim()) {
    console.error("[email/test] missing RESEND_API_KEY");
    res.status(500).json({ ok: false, error: "Resend failed" });
    return;
  }

  const parsed = bodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: "Invalid payload" });
    return;
  }

  const adminEmail =
    process.env.ADMIN_EMAIL?.trim() ||
    process.env.RESEND_TEST_TO?.trim() ||
    parsed.data.to?.trim() ||
    "";
  if (!adminEmail) {
    console.error("[email/test] missing ADMIN_EMAIL/RESEND_TEST_TO and request to");
    res.status(400).json({ ok: false, error: "Resend failed" });
    return;
  }

  const subject = parsed.data.subject || "ZARELON Email Test";
  const html = `<div style="font-family:Inter,sans-serif;background:#0D0D0D;color:#F5F5F5;padding:24px"><h2 style="color:#D8AE43">Email Test</h2><p>This is a test email from /api/email/test.</p><p style="margin-top:12px">Sent at: ${new Date().toISOString()}</p></div>`;

  const result = await sendEmail({
    to: adminEmail,
    subject,
    html,
    dedupeKey: `email-test:${adminEmail}:${subject}`,
  });

  if (!result.ok) {
    console.error("[email/test] resend sendEmail failed", result.error ?? "unknown_error");
    res.status(500).json({ ok: false, error: "Resend failed" });
    return;
  }

  console.info("[email/test] resend email sent", { to: adminEmail, id: result.id ?? null });
  res.status(200).json({ ok: true, provider: "resend", email_sent: true });
}
