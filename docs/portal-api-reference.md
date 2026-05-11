# ScooPilot Client Portal API Reference

The Client Portal API gives authenticated portal clients programmatic access to their service account. It is designed for businesses that want to build custom client-facing apps, customer dashboards, or integrate portal capabilities into their own website.

---

## Authentication

### Authenticated portal endpoints (most routes)

The portal uses **Bearer token** authentication.

1. `POST /api/portal/login` with `email` + `password` — returns `{ token, contactId }`.
2. Pass the token in every subsequent request:
   ```
   Authorization: Bearer <token>
   ```
3. Tokens expire after **7 days**. Call `POST /api/portal/logout` to invalidate early.

Portal tokens are scoped to a single contact. They cannot access other contacts' data or any staff/admin endpoints.

### Public quote endpoints (token-based, no session required)

`GET /api/portal/quotes/:id`, `POST /api/portal/quotes/:id/accept`, and `POST /api/portal/quotes/:id/decline` use a **one-time quote token** passed as a query parameter (`?token=<quoteToken>`), not a Bearer token. This token is included in the quote link sent to the client by email or SMS. These endpoints are intentionally unauthenticated so prospects can review and accept quotes before creating a portal account.

---

## Known Limitations

- **No direct service cancellation.** Clients can pause service but not permanently cancel their account via the API. Staff must action cancellation requests.
- **No new service plan creation from scratch.** Clients cannot start a new service plan without a quote from staff. The flow is: staff sends a quote → client accepts it via `POST /api/portal/quotes/:id/accept` (which creates a service plan automatically) or approves an estimate via `POST /api/portal/estimates/:id/approve`.

---

## Endpoints

### Auth

| Method | Path                          | Auth   | Description                                                                                                           |
| ------ | ----------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/portal/login`           | None   | Authenticate with email + password. Returns `{ token, contactId }`. Rate-limited to 5 failed attempts per 15 minutes. |
| POST   | `/api/portal/logout`          | Bearer | Invalidate the current session token.                                                                                 |
| POST   | `/api/portal/forgot-password` | None   | Send a password reset email. Rate-limited to 3 requests per hour. Always returns `{ success: true }`.                 |
| POST   | `/api/portal/reset-password`  | None   | Set a new password using the reset token from email. Body: `{ token, password }`. Min 10 characters.                  |
| GET    | `/api/portal/verify-email`    | None   | Confirm a pending email change. Query param: `?token=<verificationToken>`.                                            |

---

### Account & Profile

#### `GET /api/portal/me` — Bearer

Returns the authenticated client's profile.

**Response:**

```json
{
  "id": "contact_abc",
  "firstName": "Jane",
  "lastName": "Doe",
  "email": "jane@example.com",
  "phone": "555-123-4567",
  "streetAddress": "123 Main St",
  "city": "Richmond",
  "state": "VA",
  "zipCode": "23220",
  "companyName": "Green Paws Scooping",
  "pendingEmail": null,
  "currency": "usd"
}
```

#### `PATCH /api/portal/profile` — Bearer

Update profile fields. All fields are optional. Changing `email` triggers a verification email — change is pending until the link is clicked. The `properties` array updates gate codes and special instructions for existing service properties.

**Body fields (all optional):**

```json
{
  "firstName": "Jane",
  "lastName": "Doe",
  "phone": "555-123-4567",
  "email": "newemail@example.com",
  "streetAddress": "123 Main St",
  "city": "Richmond",
  "state": "VA",
  "zipCode": "23220",
  "numberOfDogs": 2,
  "properties": [{ "id": "prop_xyz", "gateCode": "1234", "specialInstructions": "Friendly dog" }]
}
```

#### `GET /api/portal/properties` — Bearer

Returns all service properties linked to the contact, including addresses, gate codes, GPS coordinates, yard size, and special instructions.

---

### Schedule & Visits

#### `GET /api/portal/schedule` — Bearer

Returns active service plans and upcoming visits for the next 60 days.

**Response:**

```json
{
  "servicePlans": [
    {
      "id": "plan_abc",
      "frequency": "weekly",
      "dayOfWeek": "tuesday",
      "pricePerVisit": "35.00",
      "isActive": true
    }
  ],
  "upcomingVisits": [
    {
      "id": "visit_xyz",
      "scheduledDate": "2026-05-13",
      "status": "scheduled",
      "propertyAddress": "123 Main St"
    }
  ]
}
```

#### `GET /api/portal/visits/history` — Bearer

Paginated visit history for the past 365 days (completed, skipped, cancelled). Includes proof-of-service photo URLs.

**Query params:** `?page=1&limit=20`

---

### Service Control

#### `POST /api/portal/pause` — Bearer

Pauses the client's service. Marks contact paused, deactivates all active service plans, cancels all future visits, and notifies staff.

**Response:** `{ "success": true, "status": "paused" }`

#### `POST /api/portal/resume` — Bearer

Resumes paused service. Reactivates plans that were paused, auto-generates visits for the next 14 days, and notifies staff.

**Response:** `{ "success": true, "status": "active" }`

#### `POST /api/portal/request-cleanup` — Bearer

Sends a one-time cleanup request notification to the company. Staff must schedule and price the work.

**Body:** `{ "preferredDate": "2026-05-20", "notes": "Extra dirty after the holiday" }`

#### `POST /api/portal/service-change` — Bearer

Submit a formal service change request (e.g., frequency change, day change) that staff reviews and acts on. Does not change the service plan directly.

**Body:**

```json
{
  "servicePlanId": "plan_abc",
  "requestType": "frequency_change",
  "requestedValue": "biweekly",
  "note": "Switching to every other week"
}
```

Common `requestType` values: `frequency_change`, `day_change`, `cancel_request`, `other`.

**Response:** `{ "success": true, "id": "scr_abc" }`

#### `GET /api/portal/service-changes` — Bearer

Returns the client's history of service change requests and their status (`pending`, `approved`, `declined`).

---

### Invoices & Payments

#### `GET /api/portal/invoices` — Bearer

Returns all non-draft, non-voided invoices. Statuses: `sent`, `pending`, `paid`, `failed`.

**Response:** Array of `{ id, invoiceNumber, dueDate, total, tipAmount, status, createdAt }`.

#### `POST /api/portal/invoices/:id/pay` — Bearer

Creates a Stripe Checkout session to pay an invoice. Optional tip.

**Body:** `{ "tipAmount": "5.00" }`

**Response:** `{ "url": "https://checkout.stripe.com/..." }` — redirect client to this URL.

#### `GET /api/portal/invoices/:id/pdf` — Bearer

Streams a PDF of the invoice as a downloadable file (`Content-Disposition: attachment`). The PDF includes company info, billing address, line items, totals, discount, and tax.

#### `GET /api/portal/billing-statement` — Bearer

Generates and streams a PDF billing statement for a date range, listing all non-voided invoices with amounts, statuses, and a grand total / outstanding balance summary.

**Query params:** `?startDate=2026-01-01&endDate=2026-05-31` (defaults to past 365 days to today)

#### `GET /api/portal/payment-methods` — Bearer

Returns saved payment methods (card brand, last 4, expiry) and autopay status.

#### `POST /api/portal/setup-intent` — Bearer

Creates a Stripe Checkout session in setup mode to add a new card without charging. Returns `{ "url": "..." }`.

#### `DELETE /api/portal/payment-methods/:id` — Bearer

Remove a saved card. The client must own the payment method.

#### `PATCH /api/portal/auto-pay` — Bearer

Enable or disable automatic payment. Body: `{ "enabled": true }`.

---

### Quotes (Public — token-based)

These three endpoints use a one-time **quote token** (`?token=<quoteToken>`) from the link sent by email/SMS. They do not require a portal session Bearer token and are accessible to prospects who don't yet have a portal account.

#### `GET /api/portal/quotes/:id?token=<quoteToken>`

View a proposal. Returns quote details (pricing tiers, property, frequency), company info, and logo URL.

**Response:**

```json
{
  "quote": {
    "id": "q_abc",
    "quoteNumber": "Q-0042",
    "type": "residential",
    "status": "sent",
    "contactName": "Jane Doe",
    "propertyAddress": "123 Main St",
    "frequency": "weekly",
    "essentialPrice": "25.00",
    "premiumPrice": "35.00",
    "deluxePrice": "45.00",
    "selectedTier": null,
    "expiresAt": "2026-06-01T00:00:00Z"
  },
  "companyName": "Green Paws Scooping",
  "companyCurrency": "usd",
  "companyLogoUrl": "https://..."
}
```

#### `POST /api/portal/quotes/:id/accept?token=<quoteToken>`

Accept a quote and select a pricing tier. Creates a service plan automatically. If the contact was a lead, their status is upgraded to active.

**Body:** `{ "tier": "essential" | "premium" | "deluxe" }`

**Response:** `{ "success": true, "tier": "premium", "price": "35.00" }`

#### `POST /api/portal/quotes/:id/decline?token=<quoteToken>`

Decline a quote.

**Body:** `{ "reason": "Going with another provider" }` (optional)

**Response:** `{ "success": true }`

---

### Estimates & Quotes (Authenticated)

Estimates are service proposals sent via the portal to authenticated clients. They differ from quotes (above) in that they require a portal session and are used for upsells, add-ons, or custom work.

#### `GET /api/portal/estimates` — Bearer

Returns all estimates sent by staff with statuses: `pending`, `approved`, `declined`.

#### `POST /api/portal/estimates/:id/approve` — Bearer

Approve a pending estimate. If a property is linked, a draft job is auto-created on the Scheduling page for staff review.

**Body:** `{ "note": "Please start next Tuesday" }`

#### `POST /api/portal/estimates/:id/decline` — Bearer

Decline a pending estimate. **Body:** `{ "reason": "..." }`

---

### Notification Preferences

#### `GET /api/portal/notifications` — Bearer

Returns the client's notification preferences.

**Response:**

```json
{
  "email": true,
  "sms": false,
  "serviceReminder": true,
  "serviceCompleted": true,
  "invoiceReady": true,
  "invoiceDueReminder": true,
  "paymentConfirmation": true,
  "reminderOptOut": false,
  "preferredChannel": "email",
  "preferredTiming": "24h_before"
}
```

#### `PATCH /api/portal/notifications` — Bearer

Update notification preferences. All fields are optional.

Valid `preferredChannel` values: `sms`, `email`, `both`

Valid `preferredTiming` values: `24h_before`, `2h_before`, `morning_of`

---

### Photo Gallery

#### `GET /api/portal/photos` — Bearer

Returns the last 50 visits with proof-of-service photos from the past 180 days. Each entry includes before and after photo URLs and the property address.

**Response:** Array of `{ id, scheduledDate, propertyAddress, proofOfServicePhoto, proofOfServicePhotoBefore }`.

---

### Messaging

#### `GET /api/portal/messages` — Bearer

Returns the full message thread between the client and the company (SMS and email), with direction, channel, subject, body, status, and timestamp.

#### `POST /api/portal/contact-us` — Bearer

Send a message to the company. Logged in the conversation thread and notifies staff.

**Body:** `{ "subject": "Question about my service", "message": "Hi, I wanted to ask..." }`

---

### Referrals

#### `GET /api/portal/referral` — Bearer

Returns the client's referral code and referral count.

#### `POST /api/portal/referral/generate` — Bearer

Generates a unique referral code (idempotent — returns existing code if already generated).

---

## Error Responses

All endpoints return standard JSON error responses:

```json
{ "error": "Description of what went wrong" }
```

Common status codes:

- `400` — Bad request (missing required fields, invalid state)
- `401` — Not authenticated or session expired
- `403` — Forbidden (trying to access another client's resource, or invalid quote token)
- `404` — Resource not found
- `429` — Rate limit exceeded

---

## Example: Full Authentication + Service Flow

```bash
# 1. Login
TOKEN=$(curl -s -X POST https://yourapp.com/api/portal/login \
  -H "Content-Type: application/json" \
  -d '{"email":"jane@example.com","password":"mypassword123"}' \
  | jq -r '.token')

# 2. Check upcoming schedule
curl -H "Authorization: Bearer $TOKEN" \
  https://yourapp.com/api/portal/schedule

# 3. Submit a service change request
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"requestType":"day_change","requestedValue":"friday","note":"New work schedule"}' \
  https://yourapp.com/api/portal/service-change

# 4. Pause service temporarily
curl -X POST -H "Authorization: Bearer $TOKEN" \
  https://yourapp.com/api/portal/pause
```

## Example: Quote acceptance flow (no portal account needed)

```bash
# The token comes from the link in the email/SMS sent by the company
QUOTE_TOKEN="abc123..."
QUOTE_ID="q_xyz"

# View the quote
curl "https://yourapp.com/api/portal/quotes/${QUOTE_ID}?token=${QUOTE_TOKEN}"

# Accept the premium tier
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"tier":"premium"}' \
  "https://yourapp.com/api/portal/quotes/${QUOTE_ID}/accept?token=${QUOTE_TOKEN}"
```
