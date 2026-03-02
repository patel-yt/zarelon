# ZARELON Security Checklist and Pentest Runbook

## 1) Immediate hardening (P0)

- Rotate these secrets now:
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `RAZORPAY_KEY_SECRET`
  - `RAZORPAY_WEBHOOK_SECRET`
  - `SHIPPING_WEBHOOK_SECRET`
  - `AUTOMATION_CRON_SECRET`
  - `RESEND_API_KEY`
- Confirm all secrets are only in Vercel Project Settings (not in repo).
- Enable Vercel Firewall and Bot Protection for `/api/*`.
- Add request rate limiting on:
  - `/api/payments/razorpay/order`
  - `/api/payments/razorpay/verify`
  - `/api/orders/cod`
  - `/api/referrals/apply`
  - `/api/orders/*/refund-request`
  - `/api/orders/*/cancel`
- Lock webhook ingestion:
  - Keep strict secret validation enabled.
  - Add provider IP allowlist at edge/firewall.
- Add alerting for suspicious events:
  - `payment_signature_mismatch`
  - `referral_abuse_blocked_ip`
  - repeated `payment_failed`
  - high-value COD events

## 2) Payment integrity checks (P0/P1)

- Razorpay verify endpoint:
  - Keep server-side HMAC signature validation.
  - Reject if order not owned by authenticated user.
  - Reject amount mismatch (add explicit amount assertion if not present).
- Webhook processing:
  - Idempotency key on `event.id` from provider payload.
  - Ignore duplicate webhook events.
  - Persist raw webhook payload in audit table.
- Refund path:
  - Keep `can_refund` permission gate.
  - Enforce refundable state transitions only.
  - Require reason and audit log on every refund action.

## 3) Auth and authorization checks (P0/P1)

- Validate every admin route with `requirePermission`/`requireAdmin`.
- Ensure no route trusts frontend role flags.
- Review all `__route` multiplexed handlers and verify per-route permission checks.
- Verify Supabase RLS is enabled for all sensitive tables:
  - `orders`, `order_items`, `referrals`, `elite_progress`, `refund_payout_accounts`,
    `user_notifications`, `referral_reminders`, `payments_audit`, `payment_risk_events`.

## 4) Abuse and fraud controls (P1)

- Keep referral anti-abuse checks:
  - IP threshold
  - device fingerprint duplication
  - self-referral block
- Add velocity caps per user and per IP for order creation.
- Add cooldown for repeated failed payment attempts.
- Add anomaly dashboard widget for risk events grouped by IP/user/device.

## 5) Data protection controls (P1)

- Mask PII in logs (`phone`, `email`, `address`, payout account fields).
- Encrypt backup snapshots.
- Restrict dashboard exports to super admin only.
- Add periodic key rotation policy (every 60-90 days).

## 6) Pentest runbook (monthly)

- Authentication tests:
  - Attempt direct access to admin APIs with user token.
  - Attempt privilege escalation by modifying frontend role fields.
- Payment tests:
  - Replay old webhook payloads.
  - Try forged webhook signature.
  - Try verify endpoint with mismatched `orderId/paymentId`.
- Business logic tests:
  - Attempt referral apply with existing user and same device.
  - Attempt repeated return/refund requests for same order item.
  - Attempt cancel after shipped/delivered.
- Access control tests:
  - Access protected drop products without valid token/invite.
  - Access vault products with lower tier user.
- Output:
  - Severity, repro steps, impacted endpoints, recommended patch, ETA.

## 7) Release gate (before each deploy)

- `npm --prefix apps/web run check`
- Manual smoke:
  - login/signup
  - Razorpay order create + verify
  - COD order create
  - customer cancel flow
  - refund request + admin refund
  - referral apply + dashboard visibility
  - webhook secret validation
- Confirm no debug/test endpoints are enabled in production.

## 8) Incident response baseline

- Create incident channel and on-call owner.
- Keep rollback plan ready (previous Vercel deployment).
- Preserve:
  - Vercel logs
  - Supabase audit/risk events
  - webhook payload copies
- User communication template for payment/refund incidents.

