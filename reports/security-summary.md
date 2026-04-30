# Security Summary Report

**Generated**: 2026-03-03
**Application**: Scoopilot - Pet Waste Removal SaaS
**Stack**: Node.js / Express / TypeScript / React / PostgreSQL

## Tools Added

| Tool                       | Purpose                                                                                        |
| -------------------------- | ---------------------------------------------------------------------------------------------- |
| `helmet`                   | Security headers (HSTS, X-Content-Type-Options, X-Frame-Options, X-DNS-Prefetch-Control, etc.) |
| `cors`                     | Strict CORS configuration with explicit origin allowlist                                       |
| `express-rate-limit`       | Rate limiting on API (500/15min) and auth endpoints (20/15min)                                 |
| `semgrep`                  | Static analysis (SAST) via scripts/security_scan.sh                                            |
| `scripts/security_scan.sh` | Automated security scanning (deps, secrets, SAST)                                              |
| `scripts/security_fix.sh`  | Safe automated dependency patching                                                             |

## Current Findings by Severity

### CRITICAL

- None

### HIGH

- **npm audit**: `minimatch` ReDoS vulnerability (transitive dependency)
- **npm audit**: `rollup` arbitrary file write via path traversal (dev dependency)
- **Status**: Both fixable via `npm audit fix`

### MODERATE

- **npm audit**: `lodash` prototype pollution in `_.unset` / `_.omit`
- **Status**: Fixable via `npm audit fix`

### LOW

- **npm audit**: `qs` arrayLimit bypass (denial of service)
- Hardcoded password hash in admin migration (`server/index.ts:97`) - this is a hash, not a plaintext credential

## SAST Results (Semgrep)

- 0 errors, 0 warnings

## Secrets Scan

- No leaked secrets detected

## What Was Hardened

### Security Middleware (Applied)

1. **Helmet security headers** - HSTS, X-Content-Type-Options, X-Frame-Options, X-DNS-Prefetch-Control, X-Download-Options, X-Permitted-Cross-Domain-Policies, Referrer-Policy
2. **Content Security Policy** - Strict directives in production (script-src, style-src, connect-src, img-src, etc.)
3. **Strict CORS** - Explicit origin allowlist via `ALLOWED_ORIGINS` env var; no wildcard with credentials
4. **Global API rate limiting** - 500 requests per 15 minutes per IP
5. **Auth endpoint rate limiting** - 20 attempts per 15 minutes per IP (login, register, forgot-password, portal login)
6. **Request body size limits** - 10MB cap on JSON and URL-encoded payloads

### IDOR Vulnerabilities Fixed (Multi-Tenant Isolation)

All DELETE and PATCH routes now verify tenant ownership via companyId:

7. **DELETE /api/tags/:id** - tag.companyId verified
8. **DELETE /api/lead-sources/:id** - leadSource.companyId verified
9. **DELETE /api/automation-rules/:id** - rule.companyId verified
10. **DELETE /api/api-keys/:id** - apiKey.companyId verified
11. **DELETE /api/webhooks/:id** - webhook.companyId verified
12. **POST /api/contacts/:id/tags** - contact and tag ownership verified
13. **DELETE /api/contacts/:id/tags/:tagId** - contact ownership verified
14. **GET /api/contacts/:id/tags** - contact ownership verified
15. **PATCH /api/automation-rules/:id** - rule ownership verified before update
16. **PATCH /api/webhooks/:id** - webhook ownership verified before update

### Already Secure (Verified, No Changes Needed)

- **PATCH/DELETE /api/contacts/:id** - uses `storage.getContact(id, companyId)`
- **PATCH/DELETE /api/properties/:id** - uses `storage.getProperty(id, companyId)`
- **PATCH/DELETE /api/routes/:id** - scoped by companyId
- **PATCH/DELETE /api/service-plans/:id** - scoped by companyId
- **PATCH /api/visits/:id** - uses `storage.getVisit(id, companyId)`
- **PATCH /api/invoices/:id** - scoped by companyId
- **PATCH/DELETE /api/pricing/:id** - scoped by companyId
- **PATCH/DELETE /api/packages/:id** - scoped by companyId
- Error handling: stack traces suppressed in client responses
- Input validation: comprehensive Zod schema validation on all endpoints
- Session cookies: HttpOnly=true, Secure=true
- Database queries: all parameterized via Drizzle ORM
- Secrets: all stored in environment variables
- Password hashing: scrypt with 64-byte key length, random salt

## Requires Manual Attention

| Item                            | File                 | Action                                                                                                                             |
| ------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Run `npm audit fix`             | package.json         | Patches transitive dep vulnerabilities                                                                                             |
| Remove admin migration hash     | `server/index.ts:97` | Remove after confirming migration applied                                                                                          |
| Set `ALLOWED_ORIGINS` env var   | Environment secrets  | Set to production domain(s) for strict CORS                                                                                        |
| Verify SendGrid sender identity | SendGrid dashboard   | Required for email delivery                                                                                                        |
| Cookie `sameSite: "none"`       | `server/index.ts`    | Required for Replit iframe; change to `"lax"` if not needed                                                                        |
| CSP tuning                      | `server/index.ts`    | Tighten directives as needed for production                                                                                        |
| CSRF tokens                     | Not implemented      | SameSite=none cookies require CSRF protection if cross-origin POST is a concern; currently mitigated by Bearer token auth fallback |

## Files Created/Modified

### Created

- `scripts/security_scan.sh` - Security scanning script (npm audit + secrets scan + semgrep SAST)
- `scripts/security_fix.sh` - Auto-fix script (npm audit fix + TypeScript check)
- `reports/security-summary.md` - This report
- `reports/dependency-audit.json` - npm audit JSON output
- `reports/secrets-scan.txt` - Secrets scan results
- `reports/sast-results.json` - Semgrep static analysis results
- `SECURITY.md` - Security documentation and incident response guide

### Modified

- `server/index.ts` - Added helmet, CORS, rate limiting middleware
- `server/routes.ts` - Fixed 10 IDOR vulnerabilities (tenant ownership checks on delete/update routes)
- `server/storage.ts` - Updated 5 delete methods to accept and enforce companyId parameter
- `replit.md` - Added Security section documenting all measures
