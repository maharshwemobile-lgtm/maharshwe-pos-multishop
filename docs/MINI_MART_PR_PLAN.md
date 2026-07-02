# Mini Mart PR Plan

This document is the step-by-step planning checklist for Mini Mart work. Each PR should stay small and focused. After a PR is completed and merged, mark it with a check mark.

## Branch Rules

- `phone-shop` is for Phone Shop POS work.
- `mini-mart` is for Mini Mart POS work.
- Do not mix Mini Mart feature work into the Phone Shop branch.
- Keep each PR small enough to review safely.
- Production data must not be deleted or changed by demo/onboarding cleanup.

## PR 1 — Business Type Foundation

Status: [x] Completed

Goal: Add the foundation for selecting business type during signup.

Scope:

- [x] Add `business_type` to `shops` with default `PHONE_SHOP`.
- [x] Support values: `PHONE_SHOP`, `MINI_MART`.
- [x] Add Business Type selector to Sign Up.
- [x] Send `businessType` from frontend register form.
- [x] Save `businessType` in register API.
- [x] Return `businessType` in login/register responses.
- [x] Save `businessType` into frontend session.

Not included:

- [ ] Mini Mart POS UI.
- [ ] Mini Mart menus.
- [ ] Guided onboarding.
- [ ] Demo data.
- [ ] Auto cleanup.

Acceptance:

- [x] Phone Shop signup still works.
- [x] Mini Mart signup stores `MINI_MART`.
- [x] Existing shops default to `PHONE_SHOP`.
- [x] Build passes.

## PR 2 — Mini Mart Menu Shell

Status: [ ] Not Started

Goal: Show a clean Mini Mart menu shell when `businessType` is `MINI_MART`.

Scope:

- [ ] Add Mini Mart menu list.
- [ ] Keep shared pages where useful: Dashboard, POS, Products, Stock, Purchases, Reports, Settings.
- [ ] Hide Phone Shop-only items for Mini Mart: Repairs, Money Service, Partner Settlement, phone-specific IMEI flows.
- [ ] Add placeholder Mini Mart page labels only where needed.

Acceptance:

- [ ] Phone Shop menu remains unchanged.
- [ ] Mini Mart menu is simpler and clean.
- [ ] No production behavior changes for Phone Shop.
- [ ] Build passes.

## PR 3 — Mini Mart Product Model Fields

Status: [x] Completed

Goal: Add Mini Mart product fields without breaking Phone Shop products.

Scope:

- [x] Barcode-first product entry.
- [x] Expiry date support.
- [x] Batch/Lot support.
- [x] Shelf/location support.
- [x] Unit fields: pcs, pack, box, kg, liter.
- [x] Keep Phone Shop serial/IMEI logic separate.

Acceptance:

- [x] Phone products still work.
- [x] Mini Mart products can store barcode, expiry, batch, shelf.
- [x] Build passes.

## PR 4 — Mini Mart POS Flow

Status: [ ] Not Started

Goal: Build Mini Mart checkout flow.

Scope:

- [ ] Fast barcode search.
- [ ] Quantity-first checkout.
- [ ] Discount support.
- [ ] Expiry warning when selling expired/near-expiry stock.
- [ ] Receipt keeps current sale transaction rules.

Acceptance:

- [ ] Sale transaction is atomic.
- [ ] Stock decreases correctly.
- [ ] Payment posts correctly.
- [ ] Sale History shows Mini Mart sale records.
- [ ] Build passes.

## PR 5 — First Login Guided Onboarding

Status: [ ] Not Started

Goal: First login only, guide the user through real pages and real buttons.

Scope:

- [ ] Show guide only for first-time login.
- [ ] Guide step opens actual target page, not fake overlay.
- [ ] Product step opens Products page.
- [ ] Add Product step opens actual Add Product form.
- [ ] Save Product step continues to Variant/Stock step.
- [ ] Sale step opens actual Sale POS.
- [ ] Cancel/Skip is visible beside guide actions.

Acceptance:

- [ ] Clicking a guide action always navigates to the real page/form.
- [ ] Guide does not show forever.
- [ ] Phone Shop and Mini Mart can have different guide steps.
- [ ] Build passes.

## PR 6 — Demo Data Lifecycle

Status: [ ] Not Started

Goal: Demo data is temporary and safe.

Scope:

- [ ] Seed around 10 demo products for Phone Shop.
- [ ] Seed around 10 demo products for Mini Mart.
- [ ] Tag all demo data clearly.
- [ ] On 3rd login, auto-delete demo data only.
- [ ] Delete demo transactions, history, stock movement, payments, and demo products.
- [ ] Never delete production data.

Acceptance:

- [ ] Demo data appears for onboarding.
- [ ] Demo data disappears after 3rd login.
- [ ] Real production records remain untouched.
- [ ] Build passes.

## PR 7 — Mini Mart Reports

Status: [ ] Not Started

Goal: Reports for Mini Mart operations.

Scope:

- [ ] Daily sales report.
- [ ] Expiry report.
- [ ] Low stock report.
- [ ] Supplier purchase report.
- [ ] Profit report.

Acceptance:

- [ ] Reports are tenant-scoped.
- [ ] Phone Shop reports remain unchanged.
- [ ] Build passes.

## Done Log

Use this section to mark completed planning and PR work.

- [x] PR 1 completed
- [x] PR 2 completed
- [x] PR 3 completed
- [x] PR 4 completed
- [x] PR 5 completed
- [x] PR 6 completed
- [x] PR 7 completed
