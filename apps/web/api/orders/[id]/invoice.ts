import PDFDocument from "pdfkit";
import type { ApiRequest, ApiResponse } from "../../_lib/http.js";
import { adminClient, getServerConfigError, requireUser, sendError } from "../../_lib/server.js";

const readOrderId = (req: ApiRequest): string | null => {
  const queryId = (req.query as Record<string, unknown>)?.id;
  if (typeof queryId === "string") return queryId;
  const match = req.url?.match(/\/api\/orders\/([^/]+)\/invoice/i);
  return match?.[1] ?? null;
};

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "GET") return sendError(res, 405, "Method not allowed");
  const serverConfigError = getServerConfigError();
  if (serverConfigError) return sendError(res, 500, serverConfigError);

  const user = await requireUser(req);
  if (!user) return sendError(res, 401, "Unauthorized");

  const orderId = readOrderId(req);
  if (!orderId) return sendError(res, 400, "Invalid order id");

  const { data: order, error } = await adminClient
    .from("orders")
    .select("id,order_number,user_id,total_inr,subtotal_inr,shipping_inr,created_at,status,payment_status,shipping_address")
    .eq("id", orderId)
    .maybeSingle();
  if (error || !order) return sendError(res, 404, "Order not found");
  if (order.user_id !== user.id) {
    const { data: profile } = await adminClient.from("users").select("role").eq("id", user.id).maybeSingle();
    if (!profile || (profile.role !== "admin" && profile.role !== "super_admin")) {
      return sendError(res, 403, "Forbidden");
    }
  }

  const { data: items } = await adminClient
    .from("order_items")
    .select("title_snapshot,price_inr,quantity,variant_label")
    .eq("order_id", order.id);

  const doc = new PDFDocument({ size: "A4", margin: 40 });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  doc.on("error", () => {});

  doc.fillColor("#111111").fontSize(24).text("ZARELON", { align: "left" });
  doc.moveDown(0.2);
  doc.fillColor("#555555").fontSize(10).text("Luxury Invoice");
  doc.moveDown();

  doc.fillColor("#111111").fontSize(11).text(`Invoice #: ${order.order_number}`);
  doc.text(`Order Date: ${new Date(order.created_at).toLocaleString()}`);
  doc.text(`Status: ${order.status} | Payment: ${order.payment_status}`);
  doc.moveDown();

  doc.fontSize(12).text("Items", { underline: true });
  doc.moveDown(0.4);
  (items ?? []).forEach((item: any, index: number) => {
    const rowTotal = (item.price_inr ?? 0) * (item.quantity ?? 0);
    const label = item.variant_label ? ` (${item.variant_label})` : "";
    doc.fontSize(10).text(
      `${index + 1}. ${item.title_snapshot}${label}  x${item.quantity}  -  INR ${(rowTotal / 100).toFixed(2)}`
    );
  });
  doc.moveDown();

  doc.fontSize(11).text(`Subtotal: INR ${((order.subtotal_inr ?? 0) / 100).toFixed(2)}`);
  doc.text(`Shipping: INR ${((order.shipping_inr ?? 0) / 100).toFixed(2)}`);
  doc.font("Helvetica-Bold").text(`Total: INR ${((order.total_inr ?? 0) / 100).toFixed(2)}`);
  doc.font("Helvetica");
  doc.moveDown();

  const address = (order.shipping_address ?? {}) as Record<string, string>;
  if (Object.keys(address).length) {
    doc.fontSize(12).text("Shipping Address", { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(10).text(`${address.fullName ?? ""}`);
    doc.text(`${address.phone ?? ""}`);
    doc.text(
      `${address.line1 ?? ""}${address.line2 ? `, ${address.line2}` : ""}, ${address.city ?? ""}, ${address.state ?? ""} ${address.postalCode ?? ""}`
    );
    doc.text(`${address.country ?? ""}`);
  }

  doc.moveDown(2);
  doc.fontSize(9).fillColor("#777777").text("Thank you for shopping with ZARELON.", { align: "center" });
  doc.end();

  await new Promise<void>((resolve) => doc.on("end", () => resolve()));
  const pdfBuffer = Buffer.concat(chunks);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename=\"ZARELON-invoice-${order.order_number}.pdf\"`);
  return res.status(200).send(pdfBuffer);
}
