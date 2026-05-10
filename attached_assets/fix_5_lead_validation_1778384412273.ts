// =============================================================================
// FILE: /lib/validate-lead.ts
// Validates required fields before a lead is submitted to the DB.
// Used in /app/api/retell/create-lead/route.ts
//
// Required fields: firstName, lastName, phone, tenantId
// Strongly recommended: email, streetAddress, zipcode
// Optional but captured when available: everything else
//
// Rationale for required vs recommended split:
// - Required: without these, the lead cannot be followed up at all
// - Recommended: missing these degrades lead quality but doesn't make
//   it worthless — the team can still call the customer back
// =============================================================================

export interface LeadPayload {
  tenantId?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  streetAddress?: string;
  city?: string;
  state?: string;
  zipcode?: string | number;
  numberOfDogs?: string | number;
  yardSize?: string;
  serviceFrequency?: string;
  preferredDay?: string;
  accumulationLevel?: string;
  accessNotes?: string;
  leadSource?: string;
}

export interface ValidationResult {
  valid: boolean;
  missingRequired: string[];
  missingRecommended: string[];
}

const REQUIRED_FIELDS: (keyof LeadPayload)[] = [
  'tenantId',
  'firstName',
  'lastName',
  'phone',
];

const RECOMMENDED_FIELDS: (keyof LeadPayload)[] = [
  'email',
  'streetAddress',
  'zipcode',
];

export function validateLead(payload: LeadPayload): ValidationResult {
  const missingRequired = REQUIRED_FIELDS.filter(
    (field) => !payload[field] || String(payload[field]).trim() === ''
  );

  const missingRecommended = RECOMMENDED_FIELDS.filter(
    (field) => !payload[field] || String(payload[field]).trim() === ''
  );

  return {
    valid: missingRequired.length === 0,
    missingRequired,
    missingRecommended,
  };
}


// =============================================================================
// USAGE: Add to /app/api/retell/create-lead/route.ts
//
// import { validateLead } from '@/lib/validate-lead';
// import { sendAlert } from '@/lib/alert';
//
// // Run validation immediately after parsing the request body,
// // before any DB queries:
//
// const validation = validateLead(body);
//
// if (!validation.valid) {
//   await sendAlert('Lead submitted with missing required fields', {
//     tenantId: body.tenantId || 'unknown',
//     missingRequired: validation.missingRequired.join(', '),
//     leadSource: body.leadSource || 'unknown',
//     timestamp: new Date().toISOString(),
//   });
//   console.error('[CREATE_LEAD] Validation failed:', validation.missingRequired);
//   return NextResponse.json(
//     {
//       error: 'Missing required fields',
//       fields: validation.missingRequired,
//     },
//     { status: 400 }
//   );
// }
//
// // Log a warning for recommended fields — don't block, just flag
// if (validation.missingRecommended.length > 0) {
//   console.warn(
//     '[CREATE_LEAD] Missing recommended fields:',
//     validation.missingRecommended.join(', ')
//   );
// }
//
// // Then proceed with DB insert and SMS as normal.
// =============================================================================
