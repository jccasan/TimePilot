const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface ProratedResult {
  amount: number;
  label: string;
  proratedThrough: string;
  regularBillingStartDate: string;
}

export function calculateProratedAmount(startDate: string, monthlyRate: number): ProratedResult {
  const start = new Date(startDate + "T00:00:00Z");
  const dayOfMonth = start.getUTCDate();
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth();

  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const endOfMonth = new Date(Date.UTC(year, month + 1, 0));
  const nextFirst = new Date(Date.UTC(year, month + 1, 1));

  const proratedThrough = endOfMonth.toISOString().split("T")[0];
  const regularBillingStartDate = nextFirst.toISOString().split("T")[0];

  if (dayOfMonth === 1) {
    return {
      amount: Math.round(monthlyRate * 100) / 100,
      label: formatPeriodLabel(start, endOfMonth),
      proratedThrough,
      regularBillingStartDate,
    };
  }

  const daysRemaining = daysInMonth - dayOfMonth + 1;
  const amount = Math.round((daysRemaining / daysInMonth) * monthlyRate * 100) / 100;

  return {
    amount,
    label: formatPeriodLabel(start, endOfMonth),
    proratedThrough,
    regularBillingStartDate,
  };
}

function formatPeriodLabel(start: Date, end: Date): string {
  const startMonth = MONTHS[start.getUTCMonth()];
  const endMonth = MONTHS[end.getUTCMonth()];
  if (start.getUTCMonth() === end.getUTCMonth()) {
    return `Prorated service \u2014 ${startMonth} ${start.getUTCDate()}\u2013${end.getUTCDate()}`;
  }
  return `Prorated service \u2014 ${startMonth} ${start.getUTCDate()} \u2013 ${endMonth} ${end.getUTCDate()}`;
}

export function monthlyRateForPlan(pricePerVisit: string, frequency: string): number {
  const price = parseFloat(pricePerVisit) || 0;
  switch (frequency) {
    case "monthly":
      return price;
    case "biweekly":
      return price * 2;
    case "weekly":
      return price * 4;
    default:
      return price;
  }
}

export function isProratable(startDate: string, invoiceFrequency: string): boolean {
  if (invoiceFrequency !== "per_month") return false;
  const d = new Date(startDate + "T00:00:00Z");
  return d.getUTCDate() !== 1;
}
