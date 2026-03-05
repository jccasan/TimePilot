import { parseCSV, parseCurrency, parseCurrencyCents, parseDate, mapInvoiceStatus } from "./import-transforms";

export interface ParsedInvoice {
  externalId: string;
  invoiceNumber: string;
  contactEmail?: string;
  contactName?: string;
  issuedDate?: string;
  dueDate: string;
  status: string;
  lineItems: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }>;
  subtotal: number;
  taxRate: number;
  tax: number;
  discountAmount: number;
  total: number;
  notes?: string;
  payments: Array<{
    amountCents: number;
    paidAt: string;
    method: string;
    reference?: string;
  }>;
}

export interface ParseError {
  row: number;
  field?: string;
  message: string;
}

export interface InvoiceParseResult {
  invoices: ParsedInvoice[];
  errors: ParseError[];
  warnings: string[];
  summary: {
    total: number;
    byStatus: Record<string, number>;
    totalAmount: number;
    totalPaid: number;
  };
}

const HEADER_MAP: Record<string, string[]> = {
  invoiceNumber: ["invoice number", "invoice #", "invoice no", "inv #", "inv no", "invoice_number", "invoicenumber", "number"],
  customerEmail: ["customer email", "email", "e-mail", "client email", "customer_email"],
  customerName: ["customer name", "client name", "customer", "client", "name", "customer_name"],
  issuedDate: ["invoice date", "date", "issued date", "issue date", "created date", "invoice_date", "issued_date"],
  dueDate: ["due date", "payment due", "due_date"],
  status: ["status", "invoice status", "payment status", "invoice_status"],
  description: ["description", "line item", "service", "item", "service description"],
  quantity: ["quantity", "qty", "count"],
  unitPrice: ["unit price", "rate", "price", "unit_price"],
  lineTotal: ["line total", "amount", "item total", "line_total", "subtotal"],
  tax: ["tax", "tax amount", "sales tax", "tax_amount"],
  taxRate: ["tax rate", "tax %", "tax_rate"],
  discount: ["discount", "discount amount", "discount_amount"],
  total: ["total", "invoice total", "grand total", "balance due", "amount due", "invoice_total"],
  paymentAmount: ["payment", "payment amount", "amount paid", "paid", "payment_amount"],
  paymentDate: ["payment date", "paid date", "date paid", "payment_date", "paid_date"],
  paymentMethod: ["payment method", "method", "payment type", "payment_method"],
  paymentReference: ["reference", "check #", "check number", "transaction id", "ref"],
  notes: ["notes", "memo", "comments"],
};

function autoMapHeaders(headers: string[]): Record<string, number> {
  const mapping: Record<string, number> = {};

  for (const [field, aliases] of Object.entries(HEADER_MAP)) {
    for (let i = 0; i < headers.length; i++) {
      const normalized = headers[i].toLowerCase().trim();
      if (aliases.includes(normalized)) {
        mapping[field] = i;
        break;
      }
    }
  }

  return mapping;
}

export function parseSweepAndGoInvoices(csvText: string): InvoiceParseResult {
  const { headers, rows } = parseCSV(csvText);
  const errors: ParseError[] = [];
  const warnings: string[] = [];
  const invoiceMap = new Map<string, ParsedInvoice>();

  if (headers.length === 0 || rows.length === 0) {
    return {
      invoices: [],
      errors: [{ row: 0, message: "Empty or invalid CSV file" }],
      warnings: [],
      summary: { total: 0, byStatus: {}, totalAmount: 0, totalPaid: 0 },
    };
  }

  const colMap = autoMapHeaders(headers);

  const requiredFields = ["invoiceNumber"];
  for (const field of requiredFields) {
    if (colMap[field] === undefined) {
      const allHeaders = headers.join(", ");
      warnings.push(`Could not auto-detect "${field}" column. Available headers: ${allHeaders}`);
    }
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;

    const get = (field: string): string => {
      const idx = colMap[field];
      return idx !== undefined ? (row[idx] || "").trim() : "";
    };

    const invoiceNumber = get("invoiceNumber") || `import-${i + 1}`;
    let existingInvoice = invoiceMap.get(invoiceNumber);

    if (!existingInvoice) {
      const rawStatus = get("status");
      const status = mapInvoiceStatus(rawStatus) || "pending";
      const rawDueDate = get("dueDate");
      const dueDate = parseDate(rawDueDate) || new Date().toISOString().split("T")[0];
      const rawIssuedDate = get("issuedDate");
      const issuedDate = parseDate(rawIssuedDate) || undefined;

      existingInvoice = {
        externalId: `sweepandgo-${invoiceNumber}`,
        invoiceNumber,
        contactEmail: get("customerEmail") || undefined,
        contactName: get("customerName") || undefined,
        issuedDate,
        dueDate,
        status,
        lineItems: [],
        subtotal: 0,
        taxRate: 0,
        tax: 0,
        discountAmount: 0,
        total: 0,
        notes: get("notes") || undefined,
        payments: [],
      };
      invoiceMap.set(invoiceNumber, existingInvoice);
    }

    const description = get("description");
    const rawQty = get("quantity");
    const rawUnitPrice = get("unitPrice");
    const rawLineTotal = get("lineTotal");

    if (description || rawQty || rawUnitPrice || rawLineTotal) {
      const quantity = rawQty ? parseInt(rawQty) || 1 : 1;
      const unitPrice = parseCurrency(rawUnitPrice) || 0;
      const lineTotal = parseCurrency(rawLineTotal) || quantity * unitPrice;

      existingInvoice.lineItems.push({ description: description || "Service", quantity, unitPrice, total: lineTotal });
    }

    const rawTax = get("tax");
    if (rawTax) {
      const tax = parseCurrency(rawTax);
      if (tax !== null) existingInvoice.tax = tax;
    }

    const rawTaxRate = get("taxRate");
    if (rawTaxRate) {
      const rate = parseFloat(rawTaxRate);
      if (!isNaN(rate)) existingInvoice.taxRate = rate;
    }

    const rawDiscount = get("discount");
    if (rawDiscount) {
      const disc = parseCurrency(rawDiscount);
      if (disc !== null) existingInvoice.discountAmount = disc;
    }

    const rawTotal = get("total");
    if (rawTotal) {
      const total = parseCurrency(rawTotal);
      if (total !== null) existingInvoice.total = total;
    }

    const rawPayment = get("paymentAmount");
    if (rawPayment) {
      const paymentAmount = parseCurrencyCents(rawPayment);
      if (paymentAmount !== null && paymentAmount > 0) {
        const rawPaymentDate = get("paymentDate");
        const paidAt = parseDate(rawPaymentDate) || existingInvoice.dueDate;
        existingInvoice.payments.push({
          amountCents: paymentAmount,
          paidAt,
          method: get("paymentMethod") || "imported",
          reference: get("paymentReference") || undefined,
        });
      }
    }
  }

  const invoicesList = Array.from(invoiceMap.values());

  for (const inv of invoicesList) {
    inv.subtotal = inv.lineItems.reduce((sum, li) => sum + li.total, 0);

    if (inv.total === 0 && inv.subtotal > 0) {
      inv.total = inv.subtotal + inv.tax - inv.discountAmount;
    }

    if (inv.subtotal > 0 && inv.total > 0) {
      const computed = inv.subtotal + inv.tax - inv.discountAmount;
      const diff = Math.abs(computed - inv.total);
      if (diff > 0.02) {
        errors.push({
          row: 0,
          field: "total",
          message: `Invoice ${inv.invoiceNumber}: line items (${inv.subtotal}) + tax (${inv.tax}) - discount (${inv.discountAmount}) = ${computed}, but total is ${inv.total} (diff: ${diff.toFixed(2)})`,
        });
      }
    }
  }

  const byStatus: Record<string, number> = {};
  let totalAmount = 0;
  let totalPaid = 0;

  for (const inv of invoicesList) {
    byStatus[inv.status] = (byStatus[inv.status] || 0) + 1;
    totalAmount += inv.total;
    totalPaid += inv.payments.reduce((sum, p) => sum + p.amountCents, 0) / 100;
  }

  return {
    invoices: invoicesList,
    errors,
    warnings,
    summary: {
      total: invoicesList.length,
      byStatus,
      totalAmount: Math.round(totalAmount * 100) / 100,
      totalPaid: Math.round(totalPaid * 100) / 100,
    },
  };
}
