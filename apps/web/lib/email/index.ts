import { Resend } from "resend";

type Recipient = string | string[];

type SendEmailInput = {
  to: Recipient;
  subject: string;
  html: string;
  from?: string;
  dedupeKey?: string;
};

type EmailResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  id?: string;
  error?: string;
};

type OrderEmailInput = {
  to: string;
  orderId: string;
  reason?: string;
  trackingNumber?: string;
  trackingUrl?: string;
};

type FestivalAnnouncementInput = {
  to: Recipient;
  festivalName: string;
  headline?: string;
  ctaText?: string;
  ctaUrl?: string;
};

type VipEarlyAccessInput = {
  to: Recipient;
  title?: string;
  accessWindow?: string;
  ctaText?: string;
  ctaUrl?: string;
};

const resendApiKey = process.env.RESEND_API_KEY?.trim();
const resend = resendApiKey ? new Resend(resendApiKey) : null;
const defaultFrom = process.env.RESEND_FROM_EMAIL?.trim() || "ZARELON <no-reply@zarelon.com>";
const dedupeWindowMs = 60_000;
const recentlySentByKey = new Map<string, number>();

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const cleanupDedupeCache = (now: number) => {
  for (const [key, timestamp] of recentlySentByKey.entries()) {
    if (now - timestamp > dedupeWindowMs) {
      recentlySentByKey.delete(key);
    }
  }
};

const shouldSkipDuplicate = (dedupeKey: string) => {
  const now = Date.now();
  cleanupDedupeCache(now);
  const lastSent = recentlySentByKey.get(dedupeKey);
  if (typeof lastSent === "number" && now - lastSent < dedupeWindowMs) return true;
  recentlySentByKey.set(dedupeKey, now);
  return false;
};

const buildOrderHtml = (title: string, details: Record<string, string>) => {
  const rows = Object.entries(details)
    .map(([key, value]) => `<p><strong>${escapeHtml(key)}:</strong> ${escapeHtml(value)}</p>`)
    .join("");
  return `<div style="font-family:Inter,sans-serif;background:#0D0D0D;color:#F5F5F5;padding:24px"><h2 style="color:#D8AE43">${escapeHtml(
    title
  )}</h2>${rows}<p style="margin-top:18px">ZARELON</p></div>`;
};

export const sendEmail = async ({ to, subject, html, from, dedupeKey }: SendEmailInput): Promise<EmailResult> => {
  try {
    if (!resend) {
      const message = "RESEND_API_KEY is missing in server environment.";
      console.error("[email] send failed:", message);
      return { ok: false, error: message };
    }

    if (dedupeKey && shouldSkipDuplicate(dedupeKey)) {
      return { ok: true, skipped: true, reason: "duplicate_within_60s" };
    }

    const response = await resend.emails.send({
      from: from || defaultFrom,
      to,
      subject,
      html,
    });

    return { ok: true, id: response.data?.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown email error";
    console.error("[email] send failed:", message);
    return { ok: false, error: message };
  }
};

export const sendOrderConfirmation = async ({ to, orderId }: OrderEmailInput): Promise<EmailResult> =>
  sendEmail({
    to,
    subject: "Order Placed - ZARELON",
    html: buildOrderHtml("Payment captured. Awaiting admin confirmation.", {
      "Order ID": orderId,
      Status: "Order Placed",
    }),
    dedupeKey: `order-confirmation:${orderId}:${to}`,
  });

export const sendOrderShipped = async ({
  to,
  orderId,
  trackingNumber,
  trackingUrl,
}: OrderEmailInput): Promise<EmailResult> =>
  sendEmail({
    to,
    subject: "Order Shipped - ZARELON",
    html: buildOrderHtml("Your order is on the way", {
      "Order ID": orderId,
      ...(trackingNumber ? { "Tracking Number": trackingNumber } : {}),
      ...(trackingUrl ? { "Tracking URL": trackingUrl } : {}),
      Status: "Shipped",
    }),
    dedupeKey: `order-shipped:${orderId}:${to}`,
  });

export const sendRefundInitiated = async ({ to, orderId, reason }: OrderEmailInput): Promise<EmailResult> =>
  sendEmail({
    to,
    subject: "Refund Processed - ZARELON",
    html: buildOrderHtml("Your refund has been processed", {
      "Order ID": orderId,
      ...(reason ? { Reason: reason } : {}),
      Status: "Refunded",
    }),
    dedupeKey: `refund-initiated:${orderId}:${to}`,
  });

export const sendFestivalAnnouncement = async ({
  to,
  festivalName,
  headline,
  ctaText,
  ctaUrl,
}: FestivalAnnouncementInput): Promise<EmailResult> =>
  sendEmail({
    to,
    subject: `${festivalName} is Live - ZARELON`,
    html: `<div style="font-family:Inter,sans-serif;background:#0D0D0D;color:#F5F5F5;padding:24px"><h2 style="color:#D8AE43">${escapeHtml(
      headline || `${festivalName} is now live`
    )}</h2><p>${escapeHtml("Explore limited-time picks curated for this festival season.")}</p>${
      ctaUrl
        ? `<p style="margin-top:16px"><a href="${escapeHtml(
            ctaUrl
          )}" style="display:inline-block;padding:10px 16px;background:#D8AE43;color:#0D0D0D;text-decoration:none;border-radius:6px;font-weight:600">${escapeHtml(
            ctaText || "Shop Now"
          )}</a></p>`
        : ""
    }</div>`,
    dedupeKey: `festival:${festivalName}:${Array.isArray(to) ? to.join(",") : to}`,
  });

export const sendVipEarlyAccess = async ({
  to,
  title,
  accessWindow,
  ctaText,
  ctaUrl,
}: VipEarlyAccessInput): Promise<EmailResult> =>
  sendEmail({
    to,
    subject: title || "VIP Early Access - ZARELON",
    html: `<div style="font-family:Inter,sans-serif;background:#0D0D0D;color:#F5F5F5;padding:24px"><h2 style="color:#D8AE43">${escapeHtml(
      title || "Your VIP window is open"
    )}</h2><p>${escapeHtml(accessWindow || "You now have early access to exclusive drops.")}</p>${
      ctaUrl
        ? `<p style="margin-top:16px"><a href="${escapeHtml(
            ctaUrl
          )}" style="display:inline-block;padding:10px 16px;background:#D8AE43;color:#0D0D0D;text-decoration:none;border-radius:6px;font-weight:600">${escapeHtml(
            ctaText || "Access Now"
          )}</a></p>`
        : ""
    }</div>`,
    dedupeKey: `vip-early-access:${Array.isArray(to) ? to.join(",") : to}`,
  });
