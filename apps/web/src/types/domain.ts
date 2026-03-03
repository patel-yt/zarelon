export type Role = "user" | "admin" | "super_admin";

export interface AdminPermissions {
  can_manage_products: boolean;
  can_manage_orders: boolean;
  can_manage_users: boolean;
  can_refund: boolean;
  can_manage_festival: boolean;
  can_view_analytics: boolean;
}

export type OrderStatus =
  | "pending"
  | "confirmed"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "refunded";

export type PaymentStatus =
  | "created"
  | "authorized"
  | "captured"
  | "failed"
  | "refunded";

export interface UserProfile {
  id: string;
  name: string | null;
  email: string;
  role: Role;
  is_blocked: boolean;
  access_tier?: "normal" | "vip" | "elite";
  vip_level?: "normal" | "vip" | "elite";
  referral_code?: string | null;
  elite_progress?: EliteProgress | null;
  elite_tier?: EliteTier | null;
  most_viewed_category?: string | null;
  most_clicked_banner?: string | null;
  recent_visits?: unknown;
}

export interface Product {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  price_inr: number;
  previous_price_inr: number | null;
  discount_percent: number;
  discount_price: number | null;
  category: string;
  stock: number;
  requires_shipping: boolean;
  requires_cod: boolean;
  return_allowed: boolean;
  exchange_allowed: boolean;
  return_window_days: number;
  featured: boolean;
  gender: "men" | "women" | "unisex";
  show_on_home: boolean;
  show_on_new_in: boolean;
  show_on_collection: boolean;
  collection_slug: string | null;
  category_slug: string | null;
  drop_id: string | null;
  festival_tag: string | null;
  image_url: string | null;
  video_url: string | null;
  bundle_with?: string[] | null;
  size_chart?: Record<string, string>[] | null;
  active: boolean;
  required_vip_level?: "normal" | "vip" | "elite";
  minimum_required_tier_id?: string | null;
  minimum_required_tier?: string | null;
  created_at: string;
  product_variants?: ProductVariant[];
}

export interface Drop {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  hero_media_type: "image" | "video";
  hero_media_url: string;
  start_time: string;
  end_time: string;
  total_stock: number;
  available_stock: number;
  access_type: "public" | "early" | "vip";
  minimum_spend_required: number | null;
  required_loyalty_points: number | null;
  early_access_hours?: number;
  early_access_tier?: string | null;
  minimum_tier_required?: string | null;
  minimum_tier_required_detail?: EliteTier | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface EliteTier {
  id: string;
  name: string;
  required_valid_referrals: number;
  badge_style: Record<string, unknown> | null;
  is_active: boolean;
}

export interface EliteProgress {
  user_id: string;
  valid_referral_count: number;
  current_tier_id: string | null;
  highest_tier_id: string | null;
  royal_crown_unlocked: boolean;
  unlocked_at: string | null;
  tier_locked?: boolean;
  permanent_royal_crown?: boolean;
  current_tier?: EliteTier | null;
  highest_tier?: EliteTier | null;
}

export interface ProductImage {
  id: string;
  product_id: string;
  image_url: string;
  alt_text: string | null;
  sort_order: number;
  is_primary: boolean;
}

export interface ProductVariant {
  id: string;
  product_id: string;
  color: string | null;
  size: string | null;
  sku: string | null;
  stock: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Banner {
  id: string;
  title: string | null;
  image_url: string;
  video_url: string | null;
  cta_label: string | null;
  cta_href: string | null;
  active: boolean;
}

export interface HeroSlide {
  id: string;
  tag: string;
  title: string;
  subtitle: string;
  cta_label: string;
  cta_href: string;
  sort_order: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CartItem {
  id: string;
  product_id: string;
  variant_id?: string | null;
  quantity: number;
  product: Product;
  variant?: ProductVariant | null;
}

export interface Cart {
  id: string;
  user_id: string;
  cart_items: CartItem[];
}

export interface ShippingAddress {
  id: string;
  user_id: string;
  label: string | null;
  full_name: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface RefundPayoutAccount {
  id: string;
  user_id: string;
  account_holder_name: string | null;
  bank_account_number: string | null;
  bank_ifsc: string | null;
  bank_name: string | null;
  upi_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Order {
  id: string;
  order_number: string;
  total_inr: number;
  total_amount: number | null;
  status: OrderStatus;
  payment_status: PaymentStatus;
  payment_provider?: string | null;
  payment_ref?: string | null;
  refund_status: string | null;
  cancel_status: string | null;
  created_at: string;
  updated_at?: string;
  order_items?: OrderItem[];
  return_requests?: ReturnRequest[];
  shipments?: Shipment[];
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  variant_id?: string | null;
  title_snapshot: string;
  price_inr: number;
  quantity: number;
  refund_attempts?: number;
  exchange_attempts?: number;
  refund_completed?: boolean;
  exchange_completed?: boolean;
  refund_locked?: boolean;
  exchange_locked?: boolean;
  active_request?: boolean;
  refund_allowed_override?: boolean;
  exchange_allowed_override?: boolean;
  manual_override_reason?: string | null;
  manual_override_admin_id?: string | null;
  manual_override_at?: string | null;
  product?: Product | null;
  variant?: ProductVariant | null;
}

export interface Festival {
  id: string;
  festival_name: string;
  slug: string;
  banner_image: string;
  start_date: string;
  end_date: string;
  active: boolean;
  festival_discount: number;
  created_at: string;
}

export interface SiteFestival {
  id: string;
  festival_name: string;
  slug: string;
  is_active: boolean;
  theme_primary: string;
  theme_secondary: string;
  hero_image_url: string;
  hero_video_url: string | null;
  discount_text: string;
  promo_text: string;
  urgency_text: string;
  discount_percent: number;
  promo_messages: string[];
  start_date: string;
  end_date: string;
  created_at: string;
  updated_at: string;
}

export interface ShipmentEvent {
  id: string;
  event_time: string;
  raw_status: string | null;
  normalized_status:
    | "placed"
    | "packed"
    | "shipped"
    | "out_for_delivery"
    | "delivered"
    | "failed"
    | "rto";
  location: string | null;
}

export interface Shipment {
  id: string;
  carrier_name: string;
  tracking_number: string;
  awb_number: string | null;
  carrier_status: string | null;
  normalized_status:
    | "placed"
    | "packed"
    | "shipped"
    | "out_for_delivery"
    | "delivered"
    | "failed"
    | "rto";
  last_event_at: string | null;
  eta: string | null;
  tracking_url: string | null;
  shipment_events?: ShipmentEvent[];
}

export interface ProductReview {
  id: string;
  product_id: string;
  user_id: string;
  rating: number;
  title: string | null;
  comment: string | null;
  image_urls: string[];
  created_at: string;
  updated_at: string;
  user?: {
    name?: string | null;
    email?: string | null;
    elite_tier?: string | null;
  } | null;
}

export interface ReturnRequest {
  id: string;
  order_id: string;
  order_item_id: string | null;
  product_id: string;
  user_id: string;
  exchange_variant_id: string | null;
  type: "RETURN" | "EXCHANGE";
  reason: string;
  description: string | null;
  photos: string[];
  status:
    | "PENDING"
    | "APPROVED"
    | "PICKUP_SCHEDULED"
    | "PICKED_UP"
    | "DELIVERED_TO_ORIGIN"
    | "REFUND_PENDING"
    | "REFUND_COMPLETED"
    | "REFUND_FAILED"
    | "REJECTED"
    | "COMPLETED";
  pickup_status?: "none" | "scheduled" | "picked_up" | "delivered_to_origin" | "failed";
  pickup_awb?: string | null;
  pickup_tracking_number?: string | null;
  pickup_tracking_url?: string | null;
  refund_id?: string | null;
  refund_status?: "none" | "pending" | "processed" | "failed";
  refund_amount_inr?: number | null;
  refunded_at?: string | null;
  admin_note: string | null;
  admin_user_id: string | null;
  created_at: string;
  updated_at: string;
  return_events?: ReturnEvent[];
}

export interface ReturnEvent {
  id: string;
  return_request_id?: string;
  event_type: string;
  message: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface SiteSection {
  id: string;
  section_key: string;
  page_location: string;
  layout_template: string | null;
  title: string | null;
  subtitle: string | null;
  description: string | null;
  media_type: "image" | "video";
  media_url: string | null;
  button_text: string | null;
  button_link: string | null;
  text_color: string | null;
  text_alignment: "left" | "center" | "right";
  overlay_opacity: number;
  display_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface HomePageConfig {
  id: string;
  layout_type: "nike" | "polo" | "rolex";
  is_active: boolean;
  smart_layout_mode: boolean;
  smart_auto_apply?: boolean;
  created_at: string;
  updated_at: string;
}

export interface HomeSection {
  id: string;
  page_id: string;
  section_key: string;
  section_type: "hero" | "featured" | "category" | "product_grid" | "custom_block";
  display_order: number;
  is_visible: boolean;
  config_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Currency {
  code: string;
  symbol: string;
  exchange_rate: number;
  country: string;
  is_active: boolean;
}

export interface Category {
  id: string;
  slug: string;
  name: string;
  parent_slug: string | null;
  image_url: string | null;
  display_image_url: string | null;
  gender: "men" | "women" | "unisex" | null;
  display_order: number;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
