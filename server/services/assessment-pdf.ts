/* eslint-disable @typescript-eslint/no-explicit-any */

export async function generateAssessmentPdf(assessment: any, companyName: string): Promise<Buffer> {
  const PDFDocument = (await import("pdfkit")).default;

  const GREEN = "#1a7a4c";
  const DARK = "#1e293b";
  const MUTED = "#64748b";
  const RED = "#ef4444";
  const YELLOW = "#eab308";

  const doc = new PDFDocument({ size: "LETTER", margin: 50, autoFirstPage: true });

  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<void>((resolve) => doc.on("end", resolve));

  function getScoreColor(score: number) {
    return score >= 70 ? GREEN : score >= 45 ? YELLOW : RED;
  }

  function sectionHeader(title: string) {
    doc.moveDown(0.5);
    doc.fontSize(12).fillColor(GREEN).text(title.toUpperCase(), { underline: false });
    doc
      .moveTo(50, doc.y + 2)
      .lineTo(562, doc.y + 2)
      .strokeColor(GREEN)
      .lineWidth(1)
      .stroke();
    doc.moveDown(0.4);
    doc.fillColor(DARK);
  }

  function bulletList(items: string[], indent = 60) {
    for (const item of items) {
      doc
        .fontSize(9)
        .fillColor(DARK)
        .text(`• ${item}`, indent, doc.y, {
          width: 512 - indent + 50,
          lineGap: 2,
        });
    }
  }

  const generatedDate = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  doc.fontSize(22).fillColor(GREEN).text("AI Business Assessment", 50, 50);
  doc.moveDown(0.2);
  doc.fontSize(13).fillColor(DARK).text(companyName);
  doc.moveDown(0.1);
  doc.fontSize(9).fillColor(MUTED).text(`Generated on ${generatedDate}`);
  doc.moveDown(0.5);

  doc.moveTo(50, doc.y).lineTo(562, doc.y).strokeColor("#e2e8f0").lineWidth(1).stroke();
  doc.moveDown(0.5);

  const healthScore = assessment.healthScore ?? 0;
  const healthScoreColor = getScoreColor(healthScore);
  doc
    .fontSize(32)
    .fillColor(healthScoreColor)
    .text(`Health Score: ${healthScore}/100`, { align: "center" });
  doc.moveDown(0.2);

  if (assessment.rating) {
    doc.fontSize(11).fillColor(MUTED).text(`Rating: ${assessment.rating}`, { align: "center" });
  }

  if (assessment.verdict) {
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor(DARK).text(assessment.verdict, { align: "left", lineGap: 3 });
  }

  if (assessment.executiveSummary) {
    const es = assessment.executiveSummary;
    sectionHeader("Executive Summary");

    if (es.topThingsWorking?.length) {
      doc.fontSize(10).fillColor(GREEN).text("What's Working:");
      bulletList(es.topThingsWorking);
      doc.moveDown(0.3);
    }
    if (es.topProblems?.length) {
      doc.fontSize(10).fillColor(RED).text("Top Problems:");
      bulletList(es.topProblems);
      doc.moveDown(0.3);
    }
    if (es.topActionsFirst?.length) {
      doc.fontSize(10).fillColor(DARK).text("Immediate Actions:");
      bulletList(es.topActionsFirst);
      doc.moveDown(0.3);
    }
    if (es.biggestRisk) {
      doc
        .fontSize(10)
        .fillColor(DARK)
        .text(`Biggest Risk: `, { continued: true })
        .fillColor(RED)
        .text(es.biggestRisk);
      doc.moveDown(0.3);
    }
    if (es.fastestWayToImprove) {
      doc
        .fontSize(10)
        .fillColor(DARK)
        .text(`Fastest Way to Improve: `, { continued: true })
        .fillColor(GREEN)
        .text(es.fastestWayToImprove);
    }
  }

  if (assessment.scoreBreakdown?.length) {
    sectionHeader("Score Breakdown");
    for (const item of assessment.scoreBreakdown) {
      const color =
        item.score / item.max >= 0.7 ? GREEN : item.score / item.max >= 0.45 ? YELLOW : RED;
      doc
        .fontSize(10)
        .fillColor(DARK)
        .text(`${item.category}: `, { continued: true })
        .fillColor(color)
        .text(`${item.score}/${item.max}`, { continued: true })
        .fillColor(MUTED)
        .text(`  — ${item.assessment}`, { lineGap: 2 });
      doc.moveDown(0.2);
    }
  }

  if (assessment.whatIsWorking?.length) {
    sectionHeader("What Is Working");
    for (const item of assessment.whatIsWorking) {
      doc.fontSize(10).fillColor(GREEN).text(`✓ ${item.name}`);
      if (item.observation)
        doc
          .fontSize(9)
          .fillColor(DARK)
          .text(item.observation, 60, doc.y, { width: 502, lineGap: 2 });
      if (item.recommendation) {
        doc.fontSize(9).fillColor(MUTED).text(`Recommendation: ${item.recommendation}`, 60, doc.y, {
          width: 502,
          lineGap: 2,
        });
      }
      doc.moveDown(0.3);
    }
  }

  if (assessment.whatIsNotWorking?.length) {
    sectionHeader("What Is Not Working");
    for (const item of assessment.whatIsNotWorking) {
      doc.fontSize(10).fillColor(RED).text(`✗ ${item.name}`);
      if (item.problem)
        doc.fontSize(9).fillColor(DARK).text(item.problem, 60, doc.y, { width: 502, lineGap: 2 });
      if (item.recommendedCorrection) {
        doc.fontSize(9).fillColor(MUTED).text(`Fix: ${item.recommendedCorrection}`, 60, doc.y, {
          width: 502,
          lineGap: 2,
        });
      }
      doc.moveDown(0.3);
    }
  }

  if (assessment.recommendations?.length) {
    sectionHeader("Key Recommendations");
    for (const rec of assessment.recommendations) {
      const pColor = rec.priority === "High" ? RED : rec.priority === "Medium" ? YELLOW : DARK;
      doc
        .fontSize(10)
        .fillColor(pColor)
        .text(`[${rec.priority}] `, { continued: true })
        .fillColor(DARK)
        .text(rec.title);
      if (rec.explanation) {
        doc
          .fontSize(9)
          .fillColor(MUTED)
          .text(rec.explanation, 60, doc.y, { width: 502, lineGap: 2 });
      }
      doc.moveDown(0.3);
    }
  }

  if (assessment.actionPlan) {
    sectionHeader("90-Day Action Plan");
    const ap = assessment.actionPlan;
    if (ap.next30?.length) {
      doc.fontSize(10).fillColor(DARK).text("Next 30 Days:");
      bulletList(ap.next30);
      doc.moveDown(0.3);
    }
    if (ap.days31to60?.length) {
      doc.fontSize(10).fillColor(DARK).text("Days 31–60:");
      bulletList(ap.days31to60);
      doc.moveDown(0.3);
    }
    if (ap.days61to90?.length) {
      doc.fontSize(10).fillColor(DARK).text("Days 61–90:");
      bulletList(ap.days61to90);
    }
  }

  if (assessment.stopStartContinue) {
    sectionHeader("Stop / Start / Continue");
    const ssc = assessment.stopStartContinue;
    if (ssc.stop?.length) {
      doc.fontSize(10).fillColor(RED).text("Stop:");
      bulletList(ssc.stop);
      doc.moveDown(0.3);
    }
    if (ssc.start?.length) {
      doc.fontSize(10).fillColor(GREEN).text("Start:");
      bulletList(ssc.start);
      doc.moveDown(0.3);
    }
    if (ssc.continue?.length) {
      doc.fontSize(10).fillColor(DARK).text("Continue:");
      bulletList(ssc.continue);
    }
  }

  if (assessment.ownerDecisions?.length) {
    sectionHeader("Owner Decisions");
    for (const od of assessment.ownerDecisions) {
      doc.fontSize(10).fillColor(DARK).text(od.decision);
      if (od.whyItMatters)
        doc.fontSize(9).fillColor(MUTED).text(`Why it matters: ${od.whyItMatters}`, { lineGap: 2 });
      if (od.recommendedAnswer)
        doc
          .fontSize(9)
          .fillColor(GREEN)
          .text(`Recommended: ${od.recommendedAnswer}`, { lineGap: 2 });
      doc.moveDown(0.3);
    }
  }

  if (assessment.finalSummary) {
    sectionHeader("Final Summary");
    doc.fontSize(10).fillColor(DARK).text(assessment.finalSummary, { lineGap: 3 });
  }

  doc.moveDown(1);
  doc.moveTo(50, doc.y).lineTo(562, doc.y).strokeColor("#e2e8f0").lineWidth(1).stroke();
  doc.moveDown(0.3);
  doc.fontSize(8).fillColor(MUTED).text("Generated by ScooPilot — AI Business Assessment", {
    align: "center",
  });

  doc.end();
  await finished;

  return Buffer.concat(chunks);
}
