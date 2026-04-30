# Security Guide

## Running Security Scans

### Quick Scan

```bash
./scripts/security_scan.sh
```

This runs three checks:

1. **Dependency audit** (npm audit) - checks for known vulnerabilities in dependencies
2. **Secrets detection** - scans source files for leaked API keys, tokens, and credentials
3. **Static analysis (SAST)** - checks for dangerous code patterns (eval, SQL injection, etc.)

Results are written to the `reports/` directory. The script exits with a non-zero code if HIGH or CRITICAL issues are found.

### Auto-Fix

```bash
./scripts/security_fix.sh
```

Applies safe automated fixes (dependency patches) and re-runs the TypeScript compiler to verify nothing is broken.

## Understanding Severity Levels

| Severity | Meaning                                 | Action              |
| -------- | --------------------------------------- | ------------------- |
| CRITICAL | Actively exploitable, data breach risk  | Fix immediately     |
| HIGH     | Exploitable under common conditions     | Fix within 24 hours |
| MODERATE | Requires specific conditions to exploit | Fix within 1 week   |
| LOW      | Theoretical risk, limited impact        | Fix when convenient |

## Secret Rotation

If a secret is leaked (found in source code, logs, or git history):

1. **Immediately rotate the secret** in the affected service (Stripe, SendGrid, etc.)
2. **Update the environment variable** in Replit Secrets
3. **Invalidate active sessions**: delete all rows from the `sessions` table
4. **Audit access logs** for unauthorized usage during the exposure window
5. **Rotate SESSION_SECRET** to invalidate all existing session cookies

### Secret Inventory

| Secret                 | Service          | Rotation Steps                        |
| ---------------------- | ---------------- | ------------------------------------- |
| SESSION_SECRET         | Express sessions | Change in Replit Secrets, restart app |
| SENDGRID_API_KEY       | SendGrid emails  | Regenerate in SendGrid dashboard      |
| ADMIN_INITIAL_PASSWORD | App admin        | Change via app UI or database         |
| MAPBOX_PUBLIC_TOKEN    | Mapbox geocoding | Regenerate in Mapbox dashboard        |
| MAPBOX_SECRET_TOKEN    | Mapbox routing   | Regenerate in Mapbox dashboard        |
| STRIPE_SECRET_KEY      | Stripe payments  | Roll key in Stripe dashboard          |
| STRIPE_WEBHOOK_SECRET  | Stripe webhooks  | Update webhook endpoint in Stripe     |

## Security Architecture

### Authentication

- Email/password with scrypt hashing (64-byte key length)
- Session cookies (HttpOnly, Secure, SameSite)
- Bearer token fallback for iframe compatibility
- Rate limiting on auth endpoints (20 attempts / 15 min)

### Authorization

- Multi-tenant isolation via companyId on all data access
- Role-based access control (owner, admin, tech)
- Forced password change for invited users
- All DELETE operations verify tenant ownership

### Infrastructure

- Helmet security headers (HSTS, X-Content-Type-Options, X-Frame-Options, etc.)
- CORS with explicit origin allowlist (no wildcard with credentials)
- Global API rate limiting (500 requests / 15 min)
- Request body size limits (10MB)
- No stack traces in error responses

### Data Protection

- Parameterized queries via Drizzle ORM (no SQL injection)
- Input validation via Zod schemas on all endpoints
- API keys stored as SHA-256 hashes
- Password reset tokens hashed and time-limited
