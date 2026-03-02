# ZARELON v1

Luxury e-commerce MVP built with React + Vite, Supabase, and Vercel API routes.

## Run locally

```bash
npm install
npm run dev
```

`npm run dev` now starts both servers:
- Vite frontend at `http://localhost:5173`
- Vercel API server at `http://localhost:3000`

If you want to run separately:

```bash
npm run dev:api
npm run dev:web
```

## Environment

Copy `.env.example` to `.env` and fill values.

For local payments/API, set:

```bash
VITE_API_BASE_URL=http://localhost:3000
```

## Included

- Public commerce routes (home, products, product detail, cart, checkout, orders, profile)
- Admin routes (dashboard, products, orders, banners, users)
- Supabase SQL schema + RLS policies in `supabase/migrations/0001_init.sql`
- Vercel-style API endpoints for Razorpay order/verify/refund, admin mutations, and webhook processing
- Basic unit tests (pricing + status transitions)
