## Summary

Briefly describe what this pull request changes and why.

## Related Issue

Closes #<!-- issue number, if applicable -->

## Changes Made

- [ ] Frontend UI / Component updates
- [ ] Service layer / State management updates
- [ ] Database migration / RPC updates (`supabase/migrations/`)
- [ ] Documentation updates (`README.md`, `docs/`)

## Architectural & Security Checklist

- [ ] Public QR pages continue to use their dedicated public RPCs and fail closed on error.
- [ ] Stock intake, stock transfer, order confirmation, and request conversion use atomic PostgreSQL RPCs without unsafe client-side fallbacks.
- [ ] Multi-tenant `business_id` and `:slug` isolation are preserved across routes, services, and `localStorage` keys.
- [ ] No secrets, `.env` files, or credentials are included in this diff.

## Verification

- [ ] `npx tsc --noEmit` passes with zero errors.
- [ ] `npm run build` succeeds cleanly.
- [ ] Tested responsive layout on mobile (`360px` / `390px`) and desktop (`1024px` / `1440px`).

