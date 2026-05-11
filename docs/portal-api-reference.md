# ScooPilot Client Portal API Reference

The Client Portal API gives authenticated portal clients programmatic access to their service account. It is designed for businesses that want to build custom client-facing apps, customer dashboards, or integrate portal capabilities into their own website.

---

## Authentication

The portal uses **Bearer token** authentication (not the staff API key system).

**Login flow:**

1. `POST /api/portal/login` with `email` + `password` — returns a `token` and `contactId`.
2. Pass the token in every subsequent request:
   ```
   Authorization: Bearer <token>
   ```
3. Tokens expire after **7 days**. Call `POST /api/portal/logout` to invalidate early.

Portal tokens are scoped to a single contact. They cannot access other contacts' data or any staff/admin endpoints.

---

## Known Limitations

- **No direct service cancellation.** Clients can pause service but not permanently cancel their account via the API. Staff must action cancellation requests.
- **No new service plan creation.** Clients cannot start a new service from scratch via the portal API. A staff member must send a quote/estimate; the client can then approve it via `POST /api/portal/estimates/:id/approve`.

---

## Endpoints

### Auth

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/portal/login` | Authenticate with email + password. Returns `{ token, contactId }`. Rate-limited to 5 failed attempts per 15 minutes. |
| POST | `/api/portal/logout` | Invalidate the current session token. |
| POST | `/api/portal/forgot-password` | Send a password reset email. Rate-limited to 3 requests per hour. Always returns `{ success: true }` regardless of whether the email was found. |
| POST | `/api/portal/reset-password` | Set a new password using the reset token from email. Body: `{ token, password }`. Password must be at least 10 characters. |
| GET | `/api/portal/verify-email` | Confirm a pending email change. Query param: `token`. |

---

### Account & Profile

#### `GET /api/portal/me`

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

#### `PATCH /api/portal/profile`

Update profile fields. All fields are optional. Changing `email` triggers a verification email to the new address — the change is not applied until the link is clicked.

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
  "properties": [
    {
      "id": "prop_xyz",
      "gateCode": "1234",
      "specialInstructions": "Dog is friendly"
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "emailVerificationSent": false,
  "pendingEmail": null,
  "profile": { ... }
}
```

---

### Properties

#### `GET /api/portal/properties`

Returns all service properties linked to the authenticated contact.

**Response:** Array of property objects including address, gate code, GPS coordinates, yard size, and special instructions.

---

### Schedule & Visits

#### `GET /api/portal/schedule`

Returns the client's active service plans and upcoming visits (next 60 days).

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

#### `GET /api/portal/visits/history`

Returns paginated past visits (last 365 days). Includes completed, skipped, and cancelled visits.

**Query params:** `page` (default 1), `limit` (default 20)

**Response:**
```json
{
  "visits": [
    {
      "id": "visit_abc",
      "scheduledDate": "2026-05-06",
      "status": "completed",
      "propertyAddress": "123 Main St",
      "completedAt": "2026-05-06T14:32:00Z",
      "proofOfServicePhoto": "https://...",
      "proofOfServicePhotoBefore": null
    }
  ],
  "total": 47,
  "page": 1,
  "totalPages": 3
}
```

---

### Service Control

#### `POST /api/portal/pause`

Pauses the client's service. Marks the contact as paused, deactivates all active service plans, and cancels all future visits from today onward. Sends an in-app notification to the company.

**Body:** none required

**Response:**
```json
{ "success": true, "status": "paused" }
```

#### `POST /api/portal/resume`

Resumes paused service. Reactivates all plans that were paused (those with a `pausedAt` timestamp). Automatically generates visits for the next 14 days.

**Body:** none required

**Response:**
```json
{ "success": true, "status": "active" }
```

#### `POST /api/portal/request-cleanup`

Sends a one-time cleanup request notification to the company. Does not create a visit or job — staff must follow up to schedule and price the work.

**Body:**
```json
{
  "preferredDate": "2026-05-20",
  "notes": "Backyard extra dirty after the holiday weekend"
}
```

**Response:**
```json
{ "success": true }
```

---

### Invoices & Payments

#### `GET /api/portal/invoices`

Returns all non-draft, non-voided invoices for the authenticated client. Statuses returned: `sent`, `pending`, `paid`, `failed`.

**Response:** Array of invoice summaries:
```json
[
  {
    "id": "inv_abc",
    "invoiceNumber": "INV-0042",
    "dueDate": "2026-05-15",
    "total": "35.00",
    "tipAmount": "0",
    "status": "sent",
    "createdAt": "2026-05-08T10:00:00Z"
  }
]
```

#### `POST /api/portal/invoices/:id/pay`

Initiates payment for an invoice via Stripe Checkout. Optionally includes a tip.

**Body:**
```json
{ "tipAmount": "5.00" }
```

**Response:**
```json
{ "url": "https://checkout.stripe.com/pay/cs_..." }
```
Redirect the client to `url` to complete payment.

#### `GET /api/portal/payment-methods`

Returns the client's saved payment methods and autopay status.

**Response:**
```json
{
  "methods": [
    {
      "id": "pm_abc",
      "brand": "visa",
      "last4": "4242",
      "expMonth": 12,
      "expYear": 2028
    }
  ],
  "autoPayEnabled": true
}
```

#### `POST /api/portal/setup-intent`

Creates a Stripe Checkout session in "setup" mode so the client can add a new card without a charge.

**Response:**
```json
{ "url": "https://checkout.stripe.com/pay/cs_..." }
```

#### `DELETE /api/portal/payment-methods/:id`

Removes a saved card. The client must own the payment method.

**Response:**
```json
{ "success": true }
```

#### `PATCH /api/portal/auto-pay`

Enable or disable automatic payment when invoices are generated.

**Body:**
```json
{ "enabled": true }
```

**Response:**
```json
{ "success": true, "autoPayEnabled": true }
```

---

### Estimates & Quotes

Estimates are service proposals sent by staff. Clients can approve or decline them.

#### `GET /api/portal/estimates`

Returns all estimates (quotes) for the authenticated client, including status (`pending`, `approved`, `declined`).

**Response:** Array of estimate objects with `id`, `description`, `items`, `totalCents`, `status`, `sentAt`, `respondedAt`, `responseNote`, `createdAt`.

#### `POST /api/portal/estimates/:id/approve`

Approves a pending estimate. If a property is linked, a draft job is automatically created on the Scheduling page for staff to review and activate.

**Body:**
```json
{ "note": "Looks good, please start next Tuesday" }
```

**Response:**
```json
{ "success": true }
```

#### `POST /api/portal/estimates/:id/decline`

Declines a pending estimate.

**Body:**
```json
{ "reason": "Going with another provider" }
```

**Response:**
```json
{ "success": true }
```

---

### Messaging

#### `GET /api/portal/messages`

Returns the full message thread between the client and the company (SMS and email).

**Response:** Array of message objects with `id`, `direction` (`inbound`/`outbound`), `channel` (`sms`/`email`), `subject`, `body`, `status`, `createdAt`.

#### `POST /api/portal/contact-us`

Sends a message to the company via email and logs it in the conversation thread. Triggers an in-app notification to staff.

**Body:**
```json
{
  "subject": "Question about my service",
  "message": "Hi, I wanted to ask about next week's schedule."
}
```

**Response:**
```json
{ "success": true, "message": "Your message has been sent." }
```

---

### Referrals

#### `GET /api/portal/referral`

Returns the client's referral code and how many successful referrals they've made.

**Response:**
```json
{ "referralCode": "REF-A1B2C3D4", "referralCount": 2 }
```

#### `POST /api/portal/referral/generate`

Generates a unique referral code for the client (if they don't already have one).

**Response:**
```json
{ "referralCode": "REF-A1B2C3D4" }
```

---

## Error Responses

All endpoints return standard JSON error responses:

```json
{ "error": "Description of what went wrong" }
```

Common status codes:
- `400` — Bad request (missing required fields, invalid state)
- `401` — Not authenticated or session expired
- `403` — Forbidden (trying to access another client's resource)
- `404` — Resource not found
- `429` — Rate limit exceeded

---

## Example: Full Authentication + Pause Flow

```bash
# 1. Login
TOKEN=$(curl -s -X POST https://yourapp.com/api/portal/login \
  -H "Content-Type: application/json" \
  -d '{"email":"jane@example.com","password":"mypassword123"}' \
  | jq -r '.token')

# 2. Check upcoming schedule
curl -H "Authorization: Bearer $TOKEN" \
  https://yourapp.com/api/portal/schedule

# 3. Pause service
curl -X POST -H "Authorization: Bearer $TOKEN" \
  https://yourapp.com/api/portal/pause
```
