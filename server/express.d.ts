import "express-session";
import "express";

declare module "express-session" {
  interface SessionData {
    userId?: string;
    portalContactId?: string;
  }
}

declare global {
  namespace Express {
    interface Request {
      adminUser?: { userId: string; email: string };
      _apiKeyAuth?: { companyId: string; scopes: string[]; keyId: string };
      crmCompanyId?: string;
      _isLeadResponseOperator?: boolean;
    }
  }
}
