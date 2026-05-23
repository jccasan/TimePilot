/* eslint-disable @typescript-eslint/no-explicit-any */
// invoice.compute.ts
// ==================
// Computes invoice totals (subtotal, discount, tax, total, paid, balance)
// and formats all currency values with the appropriate currency symbol/code.
//
// Usage:
//   import { computeInvoice, formatCurrency } from './invoice.compute';
//   const computed = computeInvoice(invoiceData, { currency: 'usd' });
//
// Input: raw invoice data object with numeric values
// Output: same object with totals.* fields computed and all money values formatted

export function formatUSD(n: number | string): string {
  return formatCurrency(n, "usd");
}

export function formatCurrency(n: number | string, currency?: string): string {
  const num = typeof n === "string" ? parseFloat(n) : n;
  if (isNaN(num)) {
    return currency === "cad" ? "CA$0.00" : "$0.00";
  }
  const formatted = num.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (currency === "cad") {
    return "CA$" + formatted;
  }
  return "$" + formatted;
}

export function computeInvoice(data: any, options?: { currency?: string }): any {
  const d = JSON.parse(JSON.stringify(data));
  const currency = options?.currency || d.invoice?.currency || "usd";
  const fmt = (n: number | string) => formatCurrency(n, currency);

  const items = d.line_items || [];
  items.forEach((li: any) => {
    li.qty = Number(li.qty) || 0;
    li.unit_price = Number(li.unit_price) || 0;
    li.line_total = li.qty * li.unit_price;
  });

  const subtotal = items.reduce((s: number, li: any) => s + li.line_total, 0);
  const discount = Number(d.totals?.discount) || 0;
  const taxRate = Number(d.totals?.tax_rate) || 0;
  const afterDiscount = Math.max(0, subtotal - discount);
  const tax = afterDiscount * taxRate;
  const total = afterDiscount + tax;
  const paid = Number(d.totals?.paid) || 0;
  const balance = total - paid;

  items.forEach((li: any) => {
    li.unit_price = fmt(li.unit_price);
    li.line_total = fmt(li.line_total);
  });

  const statusRaw = (d.invoice?.status || "draft").toLowerCase();
  const statusMap: Record<string, string> = {
    draft: "Draft",
    sent: "Sent",
    pending: "Pending",
    paid: "Paid",
    "past due": "Past Due",
    past_due: "Past Due",
    failed: "Failed",
    refunded: "Refunded",
  };
  const statusClassMap: Record<string, string> = {
    draft: "draft",
    sent: "sent",
    pending: "pending",
    paid: "paid",
    "past due": "past-due",
    past_due: "past-due",
    failed: "failed",
    refunded: "refunded",
  };

  if (d.invoice) {
    d.invoice.status = statusMap[statusRaw] || statusRaw;
    d.invoice.status_class = statusClassMap[statusRaw] || "draft";
  }

  const visitStatusLabels: Record<string, string> = {
    completed: "Completed",
    scheduled: "Scheduled",
    in_progress: "In Progress",
    skipped: "Skipped",
    cancelled: "Cancelled",
  };
  if (d.visits && Array.isArray(d.visits)) {
    d.visits.forEach((v: any) => {
      v.status_label = visitStatusLabels[v.status] || v.status;
    });
  }

  d.totals = {
    subtotal: fmt(subtotal),
    discount: fmt(discount),
    has_discount: discount > 0,
    tax_rate_display: (taxRate * 100).toFixed(1) + "%",
    tax: fmt(tax),
    // CA compliance: suppress tax row entirely when rate is 0 (small supplier / no GST registration)
    has_tax: taxRate > 0,
    total: fmt(total),
    paid: fmt(paid),
    has_paid: paid > 0,
    balance: fmt(balance),
  };

  return d;
}
