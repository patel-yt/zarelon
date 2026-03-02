export type TrackingStatus =
  | "placed"
  | "packed"
  | "shipped"
  | "out_for_delivery"
  | "delivered"
  | "failed"
  | "rto";

const normalize = (input: string): string => input.trim().toLowerCase().replace(/[\s-]+/g, "_");

const statusMap: Record<string, TrackingStatus> = {
  created: "placed",
  placed: "placed",
  packed: "packed",
  in_transit: "shipped",
  shipped: "shipped",
  out_for_delivery: "out_for_delivery",
  ofd: "out_for_delivery",
  delivered: "delivered",
  failed: "failed",
  undelivered: "failed",
  rto: "rto",
  return_to_origin: "rto",
};

export const normalizeTrackingStatus = (rawStatus: string): TrackingStatus => {
  const key = normalize(rawStatus);
  return statusMap[key] ?? "shipped";
};

export const mapTrackingToOrderStatus = (status: TrackingStatus):
  | "pending"
  | "confirmed"
  | "shipped"
  | "delivered"
  | "cancelled" => {
  switch (status) {
    case "placed":
      return "pending";
    case "packed":
      return "confirmed";
    case "shipped":
    case "out_for_delivery":
      return "shipped";
    case "delivered":
      return "delivered";
    case "failed":
    case "rto":
      return "cancelled";
    default:
      return "confirmed";
  }
};
