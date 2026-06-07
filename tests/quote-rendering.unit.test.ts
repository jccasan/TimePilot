import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  renderResidentialProposalHtml,
  renderQuoteSmsText,
  calculateResidentialPricing,
} from "../server/services/quote-pricing";
import { generateQuotePdf } from "../server/services/quote-document";

const basePricing = {
  essential: 25,
  premium: 35,
  deluxe: 45,
  initialCleanFee: 0,
  essentialFeatures: ["Weekly cleanup", "Waste removal"],
  premiumFeatures: ["Weekly cleanup", "Waste removal", "Deodorizer"],
  deluxeFeatures: ["Weekly cleanup", "Waste removal", "Deodorizer", "Gate latch check"],
  breakdown: { baseRate: 25 },
};

const baseData = {
  companyName: "Acme Scoopers",
  contactName: "Jane Smith",
  quoteNumber: "Q-0042",
  frequency: "weekly",
  pricing: basePricing,
};

describe("renderResidentialProposalHtml — logo rendering", () => {
  it("renders company logo img tag when companyLogo is provided", () => {
    const html = renderResidentialProposalHtml({
      ...baseData,
      companyLogo: "https://cdn.example.com/logo.png",
    });
    expect(html).toContain('<img src="https://cdn.example.com/logo.png"');
    expect(html).toContain('alt="Acme Scoopers"');
  });

  it("does not render an img tag when companyLogo is absent", () => {
    const html = renderResidentialProposalHtml({ ...baseData });
    expect(html).not.toContain("<img");
  });

  it("still renders company name in header regardless of logo", () => {
    const html = renderResidentialProposalHtml({ ...baseData });
    expect(html).toContain("Acme Scoopers");
  });
});

describe("renderResidentialProposalHtml — line-items vs tier-card layout", () => {
  it("renders a line-items table when lineItems are provided", () => {
    const html = renderResidentialProposalHtml({
      ...baseData,
      lineItems: [
        { pricingItemId: "item-1", name: "Dog waste removal", unitPrice: 20, quantity: 1 },
        { pricingItemId: "item-2", name: "Deodorizer spray", unitPrice: 5, quantity: 2 },
      ],
    });
    expect(html).toContain("Services Included");
    expect(html).toContain("Dog waste removal");
    expect(html).toContain("Deodorizer spray");
    expect(html).toContain("$20.00");
    expect(html).toContain("Total per visit");
    expect(html).toContain("$30.00");
  });

  it("does not render tier cards when lineItems are provided", () => {
    const html = renderResidentialProposalHtml({
      ...baseData,
      lineItems: [{ pricingItemId: "item-1", name: "Waste removal", unitPrice: 30, quantity: 1 }],
    });
    expect(html).not.toContain("Choose Your Service Level");
    expect(html).not.toContain("Essential");
    expect(html).not.toContain("Property Care");
    expect(html).not.toContain("Most Popular");
  });

  it("renders tier cards when lineItems is absent", () => {
    const html = renderResidentialProposalHtml({ ...baseData });
    expect(html).toContain("Choose Your Service Level");
    expect(html).toContain("Essential");
    expect(html).toContain("Property Care");
    expect(html).toContain("Most Popular");
  });

  it("renders tier cards when lineItems is an empty array", () => {
    const html = renderResidentialProposalHtml({ ...baseData, lineItems: [] });
    expect(html).toContain("Choose Your Service Level");
    expect(html).not.toContain("Services Included");
  });

  it("correctly calculates grand total from multiple line items", () => {
    const html = renderResidentialProposalHtml({
      ...baseData,
      lineItems: [
        { pricingItemId: "a", name: "Item A", unitPrice: 10, quantity: 3 },
        { pricingItemId: "b", name: "Item B", unitPrice: 5, quantity: 2 },
      ],
    });
    expect(html).toContain("$40.00");
  });
});

describe("renderResidentialProposalHtml — configurable tier names", () => {
  it("uses the company's configured tier names on residential tier cards", () => {
    const html = renderResidentialProposalHtml({
      ...baseData,
      tierNames: { tier1: "Good", tier2: "Better", tier3: "Best" },
    });
    expect(html).toContain("Good");
    expect(html).toContain("Better");
    expect(html).toContain("Best");
    expect(html).not.toContain("Essential");
    expect(html).not.toContain("Property Care");
    expect(html).not.toContain("Deluxe");
  });

  it("falls back to default tier names when tierNames is omitted", () => {
    const html = renderResidentialProposalHtml({ ...baseData });
    expect(html).toContain("Essential");
    expect(html).toContain("Property Care");
    expect(html).toContain("Deluxe");
  });

  it("falls back to defaults for any individual tier left unset", () => {
    const html = renderResidentialProposalHtml({
      ...baseData,
      // @ts-expect-error intentionally partial to verify per-field fallback
      tierNames: { tier1: "Bronze" },
    });
    expect(html).toContain("Bronze");
    expect(html).toContain("Property Care");
    expect(html).toContain("Deluxe");
  });
});

describe("renderQuoteSmsText — configurable tier names", () => {
  it("uses configured tier names for residential quotes", () => {
    const text = renderQuoteSmsText({
      companyName: "Acme",
      contactName: "Jane",
      quoteNumber: "Q-1",
      pricing: basePricing,
      type: "residential",
      frequency: "weekly",
      tierNames: { tier1: "Good", tier2: "Better", tier3: "Best" },
    });
    expect(text).toContain("Good: $25.00/visit");
    expect(text).toContain("Better: $35.00/visit");
    expect(text).toContain("Best: $45.00/visit");
  });

  it("ignores tier names for commercial quotes (keeps defaults)", () => {
    const text = renderQuoteSmsText({
      companyName: "Acme",
      contactName: "Jane",
      quoteNumber: "Q-1",
      pricing: basePricing,
      type: "commercial",
      frequency: "weekly",
      tierNames: { tier1: "Good", tier2: "Better", tier3: "Best" },
    });
    expect(text).toContain("Essential: $25.00/visit");
    expect(text).toContain("Property Care: $35.00/visit");
    expect(text).toContain("Deluxe: $45.00/visit");
    expect(text).not.toContain("Good:");
  });
});

describe("calculateResidentialPricing — tier names in feature copy", () => {
  const input = {
    type: "residential" as const,
    dogCount: 1,
    yardSize: "Standard",
    frequency: "weekly" as const,
    isFirstTime: false,
  };

  it("substitutes the configured tier1 / tier2 names into 'Everything in X, plus:'", () => {
    const pricing = calculateResidentialPricing(input, null, null, null, {
      tier1: "Good",
      tier2: "Better",
      tier3: "Best",
    });
    expect(pricing.premiumFeatures[0]).toBe("Everything in Good, plus:");
    expect(pricing.deluxeFeatures[0]).toBe("Everything in Better, plus:");
  });

  it("uses default tier names in feature copy when none configured", () => {
    const pricing = calculateResidentialPricing(input);
    expect(pricing.premiumFeatures[0]).toBe("Everything in Essential, plus:");
    expect(pricing.deluxeFeatures[0]).toBe("Everything in Property Care, plus:");
  });
});

describe("renderResidentialProposalHtml — logo and line-items together", () => {
  it("renders both logo and line-items table when both are provided", () => {
    const html = renderResidentialProposalHtml({
      ...baseData,
      companyLogo: "https://example.com/logo.png",
      lineItems: [{ pricingItemId: "x", name: "Full cleanup", unitPrice: 50, quantity: 1 }],
    });
    expect(html).toContain('<img src="https://example.com/logo.png"');
    expect(html).toContain("Full cleanup");
    expect(html).toContain("$50.00");
    expect(html).not.toContain("Choose Your Service Level");
  });
});

describe("renderResidentialProposalHtml — initial clean fee", () => {
  it("renders initial clean fee section when fee is greater than zero", () => {
    const html = renderResidentialProposalHtml({
      ...baseData,
      pricing: { ...basePricing, initialCleanFee: 75 },
    });
    expect(html).toContain("Initial Clean Fee");
    expect(html).toContain("$75.00");
  });

  it("does not render initial clean fee section when fee is zero", () => {
    const html = renderResidentialProposalHtml({ ...baseData });
    expect(html).not.toContain("Initial Clean Fee");
  });
});

const basePdfData = {
  companyName: "Acme Scoopers",
  contactName: "Jane Smith",
  quoteNumber: "Q-0042",
  type: "residential" as const,
  frequency: "weekly",
  essentialPrice: 25,
  premiumPrice: 35,
  deluxePrice: 45,
  initialCleanFee: 0,
  essentialFeatures: ["Weekly cleanup"],
  premiumFeatures: ["Weekly cleanup", "Deodorizer"],
  deluxeFeatures: ["Weekly cleanup", "Deodorizer", "Gate check"],
  breakdown: {},
};

describe("generateQuotePdf — smoke tests", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, arrayBuffer: async () => new ArrayBuffer(0) })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a non-empty Buffer for a residential quote without line items", async () => {
    const buf = await generateQuotePdf(basePdfData);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(100);
  });

  it("returns a non-empty Buffer when logoUrl is provided (even if fetch fails)", async () => {
    const buf = await generateQuotePdf({
      ...basePdfData,
      logoUrl: "https://example.com/logo.png",
    });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(100);
  });

  it("returns a non-empty Buffer for a residential quote with line items", async () => {
    const buf = await generateQuotePdf({
      ...basePdfData,
      lineItems: [
        { pricingItemId: "a", name: "Dog waste removal", unitPrice: 30, quantity: 1 },
        { pricingItemId: "b", name: "Deodorizer", unitPrice: 5, quantity: 2 },
      ],
    });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(100);
  });

  it("returns a non-empty Buffer when both logoUrl and line items are provided", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, arrayBuffer: async () => new ArrayBuffer(0) })
    );
    const buf = await generateQuotePdf({
      ...basePdfData,
      logoUrl: "https://example.com/logo.png",
      lineItems: [{ pricingItemId: "x", name: "Full service", unitPrice: 50, quantity: 1 }],
    });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(100);
  });
});
