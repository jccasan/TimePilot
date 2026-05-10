interface LeadPayload {
  tenantId?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  phone?: unknown;
  email?: unknown;
  streetAddress?: unknown;
  zipcode?: unknown;
  [key: string]: unknown;
}

interface LeadValidationResult {
  valid: boolean;
  missingRequired: string[];
  missingRecommended: string[];
}

const REQUIRED_FIELDS = ["tenantId", "firstName", "lastName", "phone"] as const;
const RECOMMENDED_FIELDS = ["email", "streetAddress", "zipcode"] as const;

export function validateLead(payload: LeadPayload): LeadValidationResult {
  const missingRequired = REQUIRED_FIELDS.filter(
    (f) => !payload[f] || String(payload[f]).trim() === ""
  );
  const missingRecommended = RECOMMENDED_FIELDS.filter(
    (f) => !payload[f] || String(payload[f]).trim() === ""
  );
  return {
    valid: missingRequired.length === 0,
    missingRequired,
    missingRecommended,
  };
}
