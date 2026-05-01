# Canadian Locale Test Plan

## Purpose

Verify that company accounts configured with `country=ca` and `currency=cad`
correctly display:

- Currency amounts as `CA$X.XX` (not bare `$X.XX`)
- Address form labels as "Province" (not "State") and "Postal Code" (not "Zip Code")

This test plan covers the end-to-end locale switching behavior introduced via the
`useCurrency` and `useAddressLabels` hooks.

## Prerequisites

1. Application running locally (`npm run dev`)
2. A test company with `country = 'ca'` and `currency = 'cad'` (set via DB or Settings page)
3. A user account linked to that company

### Setting up Canadian locale via DB

```sql
UPDATE companies
SET country = 'ca', currency = 'cad'
WHERE id = '<your-company-id>';
```

Or navigate to **Settings → Company Info** and set Currency to "CAD" and Country to "Canada".

---

## Test Cases

### T1 — Command Center: CA$ currency format

**URL**: `/command-center`

**Steps**:

1. Navigate to `/command-center`
2. Observe the **Today's Billing** panel (right side of the screen)

**Expected**:

- "Expected Revenue" shows `CA$X.XX`
- "Completed" shows `CA$X.XX`
- "In Progress" shows `CA$X.XX`
- "Total Invoiced" shows `CA$X.XX`
- "Total Paid" shows `CA$X.XX`

**Fail condition**: Any amount showing `$X.XX` without the `CA` prefix.

---

### T2 — Invoices: CA$ in revenue dashboard stat cards

**URL**: `/invoices`

**Steps**:

1. Navigate to `/invoices`
2. Observe the 4 stat cards at the top of the page

**Expected**:

- "This Week" (`data-testid="stat-this-week-revenue"`) → `CA$X.XX`
- "Outstanding" (`data-testid="stat-outstanding-balance"`) → `CA$X.XX`
- "Overdue" (`data-testid="stat-overdue-amount"`) → `CA$X.XX`
- "Collected This Week" (`data-testid="stat-collected-week"`) → `CA$X.XX`

**Also verify**:

- Unpaid tab badge (e.g., `Unpaid (3 · CA$150.00)`) uses `CA$`
- Overdue tab badge uses `CA$`

**Fail condition**: Any stat card or tab badge showing `$X.XX` without the `CA` prefix.

---

### T3 — Contact Detail: Province and Postal Code labels

**URL**: `/contacts/:id`

**Steps**:

1. Navigate to any contact's detail page
2. Click the **Edit** button to open the contact edit form

**Expected** (address fields in the edit form):

- The state/province field shows placeholder or label: **"Province"** (not "State")
- The zip/postal code field shows placeholder or label: **"Postal Code"** (not "Zip Code")

**Also verify** (Add Property form):

- Click "Add Property" inside the contact detail
- State/province field shows **"Province"**
- Zip/postal code field shows **"Postal Code"**

**Fail condition**: Any address form showing "State" or "Zip Code" for a CA account.

---

### T4 — Pricing: CA$ for service prices

**URL**: `/pricing`

**Steps**:

1. Navigate to `/pricing`
2. Observe service price amounts in the pricing table

**Expected**:

- All base prices in the table use `CA$X.XX` format (e.g., `CA$50.00`)

**Fail condition**: Service prices shown as `$X.XX` without `CA` prefix.

---

### T5 — Quotes: CA$ in stat card and quote list

**URL**: `/quotes`

**Steps**:

1. Navigate to `/quotes`
2. Observe the "Won Value/visit" stat card (`data-testid="text-stat-value"`)
3. If quotes exist, observe the price column in the quotes list

**Expected**:

- "Won Value/visit" stat shows `CA$X.XX`
- Individual quote prices show `CA$X.XX/visit` or `CA$X.XX–CA$X.XX` ranges

**Fail condition**: Stat card or quote prices showing bare `$X.XX` or `$X` without `CA` prefix.

---

### T6 — Routes: CA$ for stop prices and route revenue totals

**URL**: `/routes`

**Steps**:

1. Navigate to `/routes`
2. Open any existing route (or create a test route with a service plan that has a price)
3. Observe the **price per visit** displayed on each stop row
4. Observe the **total revenue** amount shown for the route

**Expected**:

- Each stop's price per visit shows `CA$X.XX`
- The route's total revenue summary shows `CA$X.XX`
- If a stop detail panel opens, the price displayed there shows `CA$X.XX`

**Fail condition**: Any price or revenue amount on the routes page showing `$X.XX`
without the `CA` prefix.

---

## Cleanup

After testing, restore the company to US locale:

```sql
UPDATE companies
SET country = 'us', currency = 'usd'
WHERE id = '<your-company-id>';
```

Or via **Settings → Company Info**.

---

## Implementation Reference

| Hook / File                              | Behavior                                                                                               |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `client/src/hooks/use-currency.ts`       | `formatMoneyForCurrency(amount, 'cad')` → `CA$X.XX` via `Intl.NumberFormat('en-US', {currency:'CAD'})` |
| `client/src/hooks/use-address-labels.ts` | `country='ca'` → `stateLabel="Province"`, `zipLabel="Postal Code"`                                     |
| `client/src/pages/invoices.tsx`          | Revenue stat cards and billing health use `formatMoney()` from `useCurrency()`                         |
| `client/src/pages/quotes.tsx`            | Won Value stat, tier prices, quote list prices use `formatMoney()`                                     |
| `client/src/pages/command-center.tsx`    | Billing section uses `formatMoney()` from `useCurrency()`                                              |
| `client/src/pages/contact-detail.tsx`    | Edit form uses `stateLabel`, `zipLabel` from `useAddressLabels()`                                      |
| `client/src/pages/routes-page.tsx`       | Stop price-per-visit and route revenue totals use `formatMoney()` from `useCurrency()`                 |

## Automated Unit Tests

Run `npx vitest run tests/canadian-locale.unit.test.ts` to verify the core
formatting function `formatMoneyForCurrency` produces `CA$X.XX` for CAD and `$X.XX`
for USD at the unit level.
