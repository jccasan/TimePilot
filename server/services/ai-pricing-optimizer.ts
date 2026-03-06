import OpenAI from "openai";
import { storage } from "../storage";
import {
  calculateAllCustomerProfitability,
  type CustomerProfitability,
} from "./profitability-calculator";
import type { PricingConfig } from "@shared/schema";

export interface AIPropertyRecommendation {
  propertyId: string;
  contactId: string;
  contactName: string;
  propertyAddress: string;
  currentPriceCents: number;
  aiRecommendedPriceCents: number;
  calculatorRecommendedPriceCents: number;
  priceChangeCents: number;
  priceChangePct: number;
  currentMarginPct: number;
  projectedMarginPct: number;
  costPerVisitCents: number;
  confidence: "high" | "medium" | "low";
  reasoning: string;
  monthlyRevenueImpactCents: number;
  annualRevenueImpactCents: number;
  frequency: string;
  dogCount: number;
  yardSizeAcres: number;
  churnRisk: "low" | "moderate" | "high";
  churnRiskReason: string;
}

export interface AIPricingAnalysis {
  generatedAt: string;
  portfolioSummary: {
    totalProperties: number;
    underpricedCount: number;
    overpricedCount: number;
    fairlyPricedCount: number;
    totalCurrentMonthlyRevenueCents: number;
    totalOptimizedMonthlyRevenueCents: number;
    potentialMonthlyGainCents: number;
    potentialAnnualGainCents: number;
    averageCurrentMarginPct: number;
    averageOptimizedMarginPct: number;
    marketPositioningSummary: string;
  };
  recommendations: AIPropertyRecommendation[];
  priorityActions: Array<{
    rank: number;
    propertyId: string;
    contactName: string;
    propertyAddress: string;
    action: string;
    revenueImpactCents: number;
    reason: string;
  }>;
  riskFlags: Array<{
    propertyId: string;
    contactName: string;
    propertyAddress: string;
    riskLevel: "moderate" | "high";
    reason: string;
    suggestedApproach: string;
  }>;
  overallInsight: string;
  aiPowered: boolean;
}

const analysisCache = new Map<string, { result: AIPricingAnalysis; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function getOpenAIClient(): OpenAI | null {
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  if (!apiKey) return null;
  return new OpenAI({ apiKey, baseURL: baseURL || undefined });
}

function getFrequencyVisitsPerMonth(frequency: string): number {
  switch (frequency) {
    case "weekly": return 4.33;
    case "biweekly": return 2.17;
    case "monthly": return 1;
    case "onetime": return 1;
    default: return 4.33;
  }
}

function buildRuleBased(
  profitability: CustomerProfitability[],
  pricingConfig: Partial<PricingConfig> | null
): AIPricingAnalysis {
  const recommendations: AIPropertyRecommendation[] = [];
  let totalCurrentMonthly = 0;
  let totalOptimizedMonthly = 0;
  let underpricedCount = 0;
  let overpricedCount = 0;
  let fairlyPricedCount = 0;

  for (const customer of profitability) {
    for (const prop of customer.properties) {
      const visitsPerMonth = getFrequencyVisitsPerMonth(prop.frequency);
      const currentMonthly = prop.revenuePerVisitCents * visitsPerMonth;
      const priceDiff = prop.recommendedPriceCents - prop.revenuePerVisitCents;
      const priceDiffPct = prop.revenuePerVisitCents > 0
        ? (priceDiff / prop.revenuePerVisitCents) * 100
        : 0;

      let aiPrice = prop.recommendedPriceCents;
      let confidence: "high" | "medium" | "low" = "medium";
      let reasoning = "";
      let churnRisk: "low" | "moderate" | "high" = "low";
      let churnRiskReason = "";

      if (prop.profitMarginPct < 0) {
        confidence = "high";
        reasoning = `This property is unprofitable with a ${prop.profitMarginPct.toFixed(1)}% margin. The cost per visit ($${(prop.costPerVisitCents / 100).toFixed(2)}) exceeds the current price. A price increase to at least $${(prop.recommendedPriceCents / 100).toFixed(2)} is needed to achieve a healthy margin.`;
        if (priceDiffPct > 30) {
          churnRisk = "high";
          churnRiskReason = `A ${priceDiffPct.toFixed(0)}% price increase may cause customer pushback. Consider a phased increase.`;
        } else if (priceDiffPct > 15) {
          churnRisk = "moderate";
          churnRiskReason = `A ${priceDiffPct.toFixed(0)}% increase is significant. Communicate the value of service when adjusting.`;
        }
        underpricedCount++;
      } else if (prop.profitMarginPct <= 15) {
        confidence = "medium";
        reasoning = `This property has a marginal ${prop.profitMarginPct.toFixed(1)}% margin. A modest price adjustment would bring it to a healthy profit level.`;
        if (priceDiffPct > 20) {
          churnRisk = "moderate";
          churnRiskReason = "The recommended increase is notable. Consider gradual adjustment.";
        }
        underpricedCount++;
      } else if (priceDiffPct < -10) {
        confidence = "low";
        reasoning = `This property is priced above the calculator's recommendation. The current margin of ${prop.profitMarginPct.toFixed(1)}% is healthy. Consider if the higher price is justified by service quality or market positioning.`;
        aiPrice = prop.revenuePerVisitCents;
        overpricedCount++;
      } else {
        confidence = "low";
        reasoning = `This property is fairly priced with a ${prop.profitMarginPct.toFixed(1)}% margin. No adjustment needed.`;
        aiPrice = prop.revenuePerVisitCents;
        fairlyPricedCount++;
      }

      const optimizedMonthly = aiPrice * visitsPerMonth;
      const monthlyImpact = optimizedMonthly - currentMonthly;
      totalCurrentMonthly += currentMonthly;
      totalOptimizedMonthly += optimizedMonthly;

      const projectedMargin = aiPrice > 0
        ? ((aiPrice - prop.costPerVisitCents) / aiPrice) * 100
        : 0;

      recommendations.push({
        propertyId: prop.propertyId,
        contactId: customer.contactId,
        contactName: customer.contactName,
        propertyAddress: prop.propertyAddress,
        currentPriceCents: prop.revenuePerVisitCents,
        aiRecommendedPriceCents: aiPrice,
        calculatorRecommendedPriceCents: prop.recommendedPriceCents,
        priceChangeCents: aiPrice - prop.revenuePerVisitCents,
        priceChangePct: prop.revenuePerVisitCents > 0 ? ((aiPrice - prop.revenuePerVisitCents) / prop.revenuePerVisitCents) * 100 : 0,
        currentMarginPct: prop.profitMarginPct,
        projectedMarginPct: Math.round(projectedMargin * 10) / 10,
        costPerVisitCents: prop.costPerVisitCents,
        confidence,
        reasoning,
        monthlyRevenueImpactCents: Math.round(monthlyImpact),
        annualRevenueImpactCents: Math.round(monthlyImpact * 12),
        frequency: prop.frequency,
        dogCount: prop.dogCount,
        yardSizeAcres: prop.yardSizeAcres,
        churnRisk,
        churnRiskReason,
      });
    }
  }

  recommendations.sort((a, b) => b.monthlyRevenueImpactCents - a.monthlyRevenueImpactCents);

  const priorityActions = recommendations
    .filter((r) => r.priceChangeCents > 0)
    .slice(0, 5)
    .map((r, i) => ({
      rank: i + 1,
      propertyId: r.propertyId,
      contactName: r.contactName,
      propertyAddress: r.propertyAddress,
      action: `Increase price from $${(r.currentPriceCents / 100).toFixed(2)} to $${(r.aiRecommendedPriceCents / 100).toFixed(2)}`,
      revenueImpactCents: r.annualRevenueImpactCents,
      reason: r.reasoning,
    }));

  const riskFlags = recommendations
    .filter((r) => r.churnRisk !== "low")
    .map((r) => ({
      propertyId: r.propertyId,
      contactName: r.contactName,
      propertyAddress: r.propertyAddress,
      riskLevel: r.churnRisk as "moderate" | "high",
      reason: r.churnRiskReason,
      suggestedApproach: r.churnRisk === "high"
        ? "Consider a phased price increase over 2-3 billing cycles, or offer added value (extra cleanups, priority scheduling)."
        : "Communicate the price adjustment clearly, emphasizing rising costs and continued service quality.",
    }));

  const potentialGain = Math.round(totalOptimizedMonthly - totalCurrentMonthly);
  const totalRev = profitability.reduce((sum, c) => sum + c.monthlyRevenueCents, 0);
  const totalCost = profitability.reduce((sum, c) => sum + c.monthlyCostCents, 0);
  const avgCurrentMargin = totalRev > 0 ? ((totalRev - totalCost) / totalRev) * 100 : 0;
  const avgOptMargin = totalOptimizedMonthly > 0
    ? ((totalOptimizedMonthly - totalCost) / totalOptimizedMonthly) * 100
    : 0;

  return {
    generatedAt: new Date().toISOString(),
    portfolioSummary: {
      totalProperties: recommendations.length,
      underpricedCount,
      overpricedCount,
      fairlyPricedCount,
      totalCurrentMonthlyRevenueCents: Math.round(totalCurrentMonthly),
      totalOptimizedMonthlyRevenueCents: Math.round(totalOptimizedMonthly),
      potentialMonthlyGainCents: potentialGain,
      potentialAnnualGainCents: potentialGain * 12,
      averageCurrentMarginPct: Math.round(avgCurrentMargin * 10) / 10,
      averageOptimizedMarginPct: Math.round(avgOptMargin * 10) / 10,
      marketPositioningSummary: underpricedCount > 0
        ? `${underpricedCount} of ${recommendations.length} properties are underpriced. Adjusting these could increase annual revenue by $${(potentialGain * 12 / 100).toFixed(2)}.`
        : "All properties are priced at or above recommended levels.",
    },
    recommendations,
    priorityActions,
    riskFlags,
    overallInsight: `Analysis of ${recommendations.length} properties across ${profitability.length} customers. ${underpricedCount} properties are underpriced and ${overpricedCount} are priced above recommendations. Optimizing pricing could yield an additional $${(potentialGain / 100).toFixed(2)}/month ($${(potentialGain * 12 / 100).toFixed(2)}/year).`,
    aiPowered: false,
  };
}

export async function generateAIPricingAnalysis(
  companyId: string
): Promise<AIPricingAnalysis> {
  const cached = analysisCache.get(companyId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.result;
  }

  const profitability = await calculateAllCustomerProfitability(companyId);
  if (profitability.length === 0) {
    const empty: AIPricingAnalysis = {
      generatedAt: new Date().toISOString(),
      portfolioSummary: {
        totalProperties: 0, underpricedCount: 0, overpricedCount: 0, fairlyPricedCount: 0,
        totalCurrentMonthlyRevenueCents: 0, totalOptimizedMonthlyRevenueCents: 0,
        potentialMonthlyGainCents: 0, potentialAnnualGainCents: 0,
        averageCurrentMarginPct: 0, averageOptimizedMarginPct: 0,
        marketPositioningSummary: "No active service plans found to analyze.",
      },
      recommendations: [], priorityActions: [], riskFlags: [],
      overallInsight: "No active customers with service plans found. Add customers and service plans to generate pricing recommendations.",
      aiPowered: false,
    };
    return empty;
  }

  const company = await storage.getCompany(companyId);
  const pricingConfig = (company?.pricingConfig as Partial<PricingConfig>) ?? null;

  const ruleBasedResult = buildRuleBased(profitability, pricingConfig);

  const openai = getOpenAIClient();
  if (!openai) {
    console.log("[AI Pricing] OpenAI not configured, returning rule-based analysis");
    analysisCache.set(companyId, { result: ruleBasedResult, timestamp: Date.now() });
    return ruleBasedResult;
  }

  try {
    const propertyData = profitability.flatMap((customer) =>
      customer.properties.map((prop) => ({
        contactName: customer.contactName,
        propertyAddress: prop.propertyAddress,
        propertyId: prop.propertyId,
        contactId: customer.contactId,
        frequency: prop.frequency,
        dogCount: prop.dogCount,
        yardSizeAcres: Math.round(prop.yardSizeAcres * 1000) / 1000,
        yardDifficulty: prop.yardDifficulty,
        currentPriceCents: prop.revenuePerVisitCents,
        costPerVisitCents: prop.costPerVisitCents,
        profitPerVisitCents: prop.profitPerVisitCents,
        profitMarginPct: prop.profitMarginPct,
        recommendedPriceCents: prop.recommendedPriceCents,
        costBreakdown: prop.costBreakdown,
      }))
    );

    const marketAvg = pricingConfig?.localMarketAverageWeeklyPriceCents
      ? `$${(pricingConfig.localMarketAverageWeeklyPriceCents / 100).toFixed(2)}/visit weekly`
      : "not configured";

    const prompt = `You are a pricing strategy expert for pet waste removal (pooper scooper) businesses. Analyze this portfolio of properties and provide optimized pricing recommendations.

BUSINESS CONTEXT:
- Industry: Pet waste removal / pooper scooper service
- Market average weekly price: ${marketAvg}
- Target profit margin: ${pricingConfig?.targetProfitMarginPct ?? 30}%
- ${propertyData.length} properties across ${profitability.length} customers

PROPERTY DATA:
${JSON.stringify(propertyData.slice(0, 50), null, 0)}

For each property, provide:
1. An optimized price (in cents) considering market positioning, cost structure, and competitive factors
2. Confidence level (high/medium/low) in the recommendation
3. Brief reasoning (1-2 sentences)
4. Churn risk if price is changed (low/moderate/high) with reason
5. Monthly and annual revenue impact

Also provide:
- A portfolio summary with counts of underpriced/overpriced/fairly priced
- Top 5 priority actions ranked by revenue impact
- Risk flags for properties where price increases could cause customer loss
- An overall insight paragraph

Respond with ONLY valid JSON in this exact format:
{
  "portfolioSummary": {
    "underpricedCount": 0,
    "overpricedCount": 0,
    "fairlyPricedCount": 0,
    "marketPositioningSummary": "string",
    "averageOptimizedMarginPct": 0
  },
  "recommendations": [
    {
      "propertyId": "id",
      "aiRecommendedPriceCents": 0,
      "confidence": "high|medium|low",
      "reasoning": "string",
      "churnRisk": "low|moderate|high",
      "churnRiskReason": "string"
    }
  ],
  "priorityActions": [
    {
      "rank": 1,
      "propertyId": "id",
      "action": "string",
      "reason": "string"
    }
  ],
  "riskFlags": [
    {
      "propertyId": "id",
      "riskLevel": "moderate|high",
      "reason": "string",
      "suggestedApproach": "string"
    }
  ],
  "overallInsight": "string"
}`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("Empty AI response");

    const aiResult = JSON.parse(content);

    const propMap = new Map(propertyData.map((p) => [p.propertyId, p]));
    const merged: AIPropertyRecommendation[] = [];

    for (const rec of ruleBasedResult.recommendations) {
      const aiRec = aiResult.recommendations?.find((r: any) => r.propertyId === rec.propertyId);
      const propData = propMap.get(rec.propertyId);

      if (aiRec && propData) {
        const aiPrice = Math.round(aiRec.aiRecommendedPriceCents / 100) * 100;
        const priceChange = aiPrice - rec.currentPriceCents;
        const visitsPerMonth = getFrequencyVisitsPerMonth(rec.frequency);
        const monthlyImpact = priceChange * visitsPerMonth;
        const projMargin = aiPrice > 0
          ? ((aiPrice - rec.costPerVisitCents) / aiPrice) * 100
          : 0;

        merged.push({
          ...rec,
          aiRecommendedPriceCents: aiPrice,
          priceChangeCents: priceChange,
          priceChangePct: rec.currentPriceCents > 0 ? (priceChange / rec.currentPriceCents) * 100 : 0,
          projectedMarginPct: Math.round(projMargin * 10) / 10,
          confidence: aiRec.confidence || rec.confidence,
          reasoning: aiRec.reasoning || rec.reasoning,
          monthlyRevenueImpactCents: Math.round(monthlyImpact),
          annualRevenueImpactCents: Math.round(monthlyImpact * 12),
          churnRisk: aiRec.churnRisk || rec.churnRisk,
          churnRiskReason: aiRec.churnRiskReason || rec.churnRiskReason,
        });
      } else {
        merged.push(rec);
      }
    }

    merged.sort((a, b) => b.monthlyRevenueImpactCents - a.monthlyRevenueImpactCents);

    const totalCurrentMonthly = merged.reduce((s, r) => s + r.currentPriceCents * getFrequencyVisitsPerMonth(r.frequency), 0);
    const totalOptMonthly = merged.reduce((s, r) => s + r.aiRecommendedPriceCents * getFrequencyVisitsPerMonth(r.frequency), 0);
    const potentialGain = Math.round(totalOptMonthly - totalCurrentMonthly);

    const totalCost = profitability.reduce((s, c) => s + c.monthlyCostCents, 0);
    const avgCurrMargin = totalCurrentMonthly > 0 ? ((totalCurrentMonthly - totalCost) / totalCurrentMonthly) * 100 : 0;

    const result: AIPricingAnalysis = {
      generatedAt: new Date().toISOString(),
      portfolioSummary: {
        totalProperties: merged.length,
        underpricedCount: aiResult.portfolioSummary?.underpricedCount ?? ruleBasedResult.portfolioSummary.underpricedCount,
        overpricedCount: aiResult.portfolioSummary?.overpricedCount ?? ruleBasedResult.portfolioSummary.overpricedCount,
        fairlyPricedCount: aiResult.portfolioSummary?.fairlyPricedCount ?? ruleBasedResult.portfolioSummary.fairlyPricedCount,
        totalCurrentMonthlyRevenueCents: Math.round(totalCurrentMonthly),
        totalOptimizedMonthlyRevenueCents: Math.round(totalOptMonthly),
        potentialMonthlyGainCents: potentialGain,
        potentialAnnualGainCents: potentialGain * 12,
        averageCurrentMarginPct: Math.round(avgCurrMargin * 10) / 10,
        averageOptimizedMarginPct: aiResult.portfolioSummary?.averageOptimizedMarginPct ?? ruleBasedResult.portfolioSummary.averageOptimizedMarginPct,
        marketPositioningSummary: aiResult.portfolioSummary?.marketPositioningSummary ?? ruleBasedResult.portfolioSummary.marketPositioningSummary,
      },
      recommendations: merged,
      priorityActions: (aiResult.priorityActions || []).slice(0, 5).map((a: any, i: number) => {
        const rec = merged.find((r) => r.propertyId === a.propertyId);
        return {
          rank: i + 1,
          propertyId: a.propertyId,
          contactName: rec?.contactName ?? "",
          propertyAddress: rec?.propertyAddress ?? "",
          action: a.action,
          revenueImpactCents: rec?.annualRevenueImpactCents ?? 0,
          reason: a.reason,
        };
      }),
      riskFlags: (aiResult.riskFlags || []).map((f: any) => {
        const rec = merged.find((r) => r.propertyId === f.propertyId);
        return {
          propertyId: f.propertyId,
          contactName: rec?.contactName ?? "",
          propertyAddress: rec?.propertyAddress ?? "",
          riskLevel: f.riskLevel,
          reason: f.reason,
          suggestedApproach: f.suggestedApproach,
        };
      }),
      overallInsight: aiResult.overallInsight || ruleBasedResult.overallInsight,
      aiPowered: true,
    };

    if (result.priorityActions.length === 0) {
      result.priorityActions = ruleBasedResult.priorityActions;
    }

    analysisCache.set(companyId, { result, timestamp: Date.now() });
    return result;
  } catch (error) {
    console.error("[AI Pricing] AI analysis failed, returning rule-based:", error);
    ruleBasedResult.overallInsight += " (AI analysis unavailable, showing rule-based recommendations.)";
    analysisCache.set(companyId, { result: ruleBasedResult, timestamp: Date.now() });
    return ruleBasedResult;
  }
}

export async function generatePropertyAnalysis(
  companyId: string,
  propertyId: string
): Promise<AIPropertyRecommendation | null> {
  const analysis = await generateAIPricingAnalysis(companyId);
  return analysis.recommendations.find((r) => r.propertyId === propertyId) ?? null;
}

export function clearAnalysisCache(companyId: string) {
  analysisCache.delete(companyId);
}
