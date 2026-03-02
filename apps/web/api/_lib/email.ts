import {
  sendEmail,
  sendOrderConfirmation,
  sendOrderShipped,
  sendRefundInitiated,
} from "../../lib/email/index.js";

export const sendOrderEmail = async (
  to: string,
  subject: string,
  title: string,
  details: Record<string, string>
) => {
  if (!to) return;
  const rows = Object.entries(details)
    .map(([key, value]) => `<p><strong>${key}:</strong> ${value}</p>`)
    .join("");

  await sendEmail({
    to,
    subject,
    html: `<div style="font-family:Inter,sans-serif;background:#0D0D0D;color:#F5F5F5;padding:24px"><h2 style="color:#D8AE43">${title}</h2>${rows}<p style="margin-top:18px">ZARELON</p></div>`,
    dedupeKey: `legacy-order-email:${subject}:${details["Order ID"] ?? "na"}:${to}`,
  });
};

export { sendEmail, sendOrderConfirmation, sendOrderShipped, sendRefundInitiated };
