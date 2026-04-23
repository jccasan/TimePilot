import PDFDocument from "pdfkit";
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, AlignmentType, HeadingLevel, ShadingType,
  ImageRun, convertInchesToTwip,
} from "docx";

interface QuoteImage {
  url: string;
  caption: string;
  sqft?: number;
}

interface QuoteDocData {
  companyName: string;
  companyEmail?: string;
  companyPhone?: string;
  contactName: string;
  quoteNumber: string;
  propertyAddress?: string;
  type: string;
  frequency: string;
  expiresAt?: string;
  notes?: string;
  essentialPrice: number;
  premiumPrice: number;
  deluxePrice: number;
  initialCleanFee: number;
  essentialFeatures: string[];
  premiumFeatures: string[];
  deluxeFeatures: string[];
  breakdown: Record<string, any>;
  images?: QuoteImage[];
  baseUrl?: string;
}

const GREEN = "#1a7a4c";
const DARK = "#1e293b";
const MUTED = "#64748b";

function frequencyLabel(freq: string): string {
  if (freq === "weekly") return "Weekly";
  if (freq === "biweekly") return "Bi-weekly";
  if (freq === "monthly") return "Monthly";
  if (freq === "1x_weekly") return "1x Weekly";
  if (freq === "2x_weekly") return "2x Weekly";
  if (freq === "3x_weekly") return "3x Weekly";
  return freq;
}

function filterFeatures(features: string[]): string[] {
  return features.filter(f => f && f.trim().length > 0);
}

function resolveImageUrl(url: string, baseUrl?: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const path = url.startsWith('/') ? url : `/objects/${url}`;
  return baseUrl ? `${baseUrl}${path}` : path;
}

interface FetchedImage {
  buffer: Buffer;
  caption: string;
  sqft?: number;
  width: number;
  height: number;
}

async function fetchImageBuffers(images: QuoteImage[], baseUrl?: string): Promise<FetchedImage[]> {
  const results: FetchedImage[] = [];
  for (const img of images) {
    try {
      const fullUrl = resolveImageUrl(img.url, baseUrl);
      const res = await fetch(fullUrl);
      if (!res.ok) continue;
      const arrayBuf = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);

      let width = 400;
      let height = 300;
      if (buffer.length > 24) {
        const dims = getImageDimensions(buffer);
        if (dims) {
          width = dims.width;
          height = dims.height;
        }
      }

      results.push({ buffer, caption: img.caption, sqft: img.sqft, width, height });
    } catch (err) {
      console.error(`Failed to fetch image ${img.url}:`, err);
    }
  }
  return results;
}

function getImageDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf[0] === 0x89 && buf[1] === 0x50) {
    if (buf.length >= 24) {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
  }
  if (buf[0] === 0xFF && buf[1] === 0xD8) {
    let offset = 2;
    while (offset < buf.length - 1) {
      if (buf[offset] !== 0xFF) break;
      const marker = buf[offset + 1];
      if (marker === 0xC0 || marker === 0xC2) {
        if (offset + 9 < buf.length) {
          return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
        }
      }
      if (offset + 3 < buf.length) {
        const segLen = buf.readUInt16BE(offset + 2);
        offset += 2 + segLen;
      } else {
        break;
      }
    }
  }
  return null;
}

export async function generateQuotePdf(data: QuoteDocData): Promise<Buffer> {
  const fetchedImages = data.images && data.images.length > 0
    ? await fetchImageBuffers(data.images, data.baseUrl)
    : [];

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageBottom = doc.page.height - 60;
    const contentWidth = doc.page.width - 100;
    let y = 0;

    function checkPage(needed: number) {
      if (y + needed > pageBottom) {
        doc.addPage();
        y = 50;
      }
    }

    doc.rect(0, 0, doc.page.width, 90).fill(GREEN);
    doc.fontSize(20).fillColor("white").text(data.companyName, 50, 25, { align: "center" });
    doc.fontSize(11).fillColor("rgba(255,255,255,0.8)").text(
      `Service Quote #${data.quoteNumber}`,
      50, 52, { align: "center" }
    );

    y = 110;
    doc.fillColor(MUTED).fontSize(10).text("Prepared for", 50, y);
    y += 14;
    doc.fillColor(DARK).fontSize(14).font("Helvetica-Bold").text(data.contactName, 50, y);
    y += 20;
    doc.font("Helvetica");

    if (data.propertyAddress) {
      checkPage(16);
      doc.fillColor("#475569").fontSize(10).text(`Property: ${data.propertyAddress}`, 50, y);
      y += 16;
    }
    checkPage(16);
    doc.fillColor("#475569").fontSize(10).text(`Service Frequency: ${frequencyLabel(data.frequency)}`, 50, y);
    y += 24;

    if (data.type === "commercial" && data.breakdown) {
      checkPage(30);
      doc.fillColor(DARK).fontSize(13).font("Helvetica-Bold").text("Scope of Work", 50, y);
      y += 18;
      doc.font("Helvetica").fillColor("#475569").fontSize(10);
      const bd = data.breakdown;

      const scopeItems: [string, string][] = [];
      if (bd.stationCount > 0) {
        scopeItems.push(["Waste Stations", `${bd.stationCount} station${bd.stationCount !== 1 ? 's' : ''} maintained per visit`]);
      }
      if (bd.commonAreaMinutes) {
        scopeItems.push(["Common Area", `${bd.commonAreaMinutes} min`]);
      }
      if (bd.crewSize) {
        scopeItems.push(["Crew Size", `${bd.crewSize} person(s)`]);
      }
      if (bd.totalLaborHours) {
        scopeItems.push(["On-Site Labor", `${bd.totalLaborHours} hrs with ${bd.crewSize || 1}-person crew`]);
      }
      if (bd.mileageCost && bd.mileageCost > 0) {
        scopeItems.push(["Travel", `Included (${bd.mileageDistance || 0} mi round-trip)`]);
      }
      if (bd.dumpFee && bd.dumpFee > 0) {
        scopeItems.push(["Waste Disposal", `Included`]);
      }

      for (const [label, val] of scopeItems) {
        checkPage(15);
        doc.fillColor(DARK).font("Helvetica-Bold").text(`${label}:`, 60, y, { continued: true });
        doc.font("Helvetica").fillColor("#475569").text(`  ${val}`);
        y += 15;
      }
      y += 10;
    }

    const tiers = [
      { name: "Essential", price: data.essentialPrice, features: filterFeatures(data.essentialFeatures) },
      { name: "Property Care", price: data.premiumPrice, features: filterFeatures(data.premiumFeatures) },
      { name: "Deluxe", price: data.deluxePrice, features: filterFeatures(data.deluxeFeatures) },
    ];

    const maxFeatures = tiers.reduce((max, t) => Math.max(max, t.features.length), 0);
    const tierBlockHeight = 60 + maxFeatures * 14;
    checkPage(tierBlockHeight + 30);

    doc.fillColor(DARK).fontSize(14).font("Helvetica-Bold").text("Service Packages", 50, y, { align: "center" });
    y += 24;
    doc.font("Helvetica");

    const colW = (doc.page.width - 120) / 3;
    const startX = 50;

    for (let i = 0; i < tiers.length; i++) {
      const tier = tiers[i];
      const x = startX + i * (colW + 10);
      const boxTop = y;

      doc.save();
      doc.roundedRect(x, boxTop, colW, 20, 4).fill(i === 1 ? GREEN : "#f1f5f9");
      doc.fillColor(i === 1 ? "white" : DARK).fontSize(10).font("Helvetica-Bold")
        .text(tier.name, x, boxTop + 5, { width: colW, align: "center" });

      const priceY = boxTop + 26;
      doc.fillColor(GREEN).fontSize(18).font("Helvetica-Bold")
        .text(`$${tier.price.toFixed(2)}`, x, priceY, { width: colW, align: "center" });
      doc.fillColor(MUTED).fontSize(8).font("Helvetica")
        .text("/visit", x, priceY + 20, { width: colW, align: "center" });

      let fy = priceY + 36;
      doc.font("Helvetica").fontSize(8).fillColor("#475569");
      for (const f of tier.features) {
        doc.text(`✓ ${f}`, x + 8, fy, { width: colW - 16 });
        fy += doc.heightOfString(`✓ ${f}`, { width: colW - 16 }) + 3;
      }
      doc.restore();
    }

    y += 50 + maxFeatures * 14;

    if (data.initialCleanFee > 0) {
      checkPage(40);
      y += 10;
      doc.save();
      doc.roundedRect(50, y, doc.page.width - 100, 28, 4).fill("#fef3c7");
      doc.fillColor("#92400e").fontSize(10).font("Helvetica-Bold")
        .text(`Initial Clean Fee: $${data.initialCleanFee.toFixed(2)} (one-time)`, 60, y + 8, { width: doc.page.width - 120 });
      doc.restore();
      y += 40;
    }

    if (fetchedImages.length > 0) {
      checkPage(30);
      y += 10;
      const sectionTitle = data.type === "commercial" ? "Site Overview" : "Property Measurement";
      doc.fillColor(DARK).fontSize(13).font("Helvetica-Bold").text(sectionTitle, 50, y);
      y += 20;
      doc.font("Helvetica");

      for (const img of fetchedImages) {
        const maxImgWidth = contentWidth;
        const maxImgHeight = 280;
        const scale = Math.min(maxImgWidth / img.width, maxImgHeight / img.height, 1);
        const renderW = img.width * scale;
        const renderH = img.height * scale;

        checkPage(renderH + 30);

        try {
          doc.image(img.buffer, 50, y, { width: renderW, height: renderH });
          y += renderH + 6;
        } catch (imgErr) {
          console.error("Failed to embed image in PDF:", imgErr);
          continue;
        }

        doc.fillColor(MUTED).fontSize(9).text(img.caption, 50, y, { width: contentWidth, align: "center" });
        y += 16;
      }
    }

    if (data.notes) {
      const notesHeight = doc.heightOfString(data.notes, { width: doc.page.width - 100 });
      checkPage(notesHeight + 30);
      y += 10;
      doc.fillColor(DARK).fontSize(11).font("Helvetica-Bold").text("Notes", 50, y);
      y += 16;
      doc.font("Helvetica").fillColor("#475569").fontSize(10).text(data.notes, 50, y, { width: doc.page.width - 100 });
      y += notesHeight + 10;
    }

    if (data.expiresAt) {
      checkPage(20);
      y += 10;
      doc.fillColor(MUTED).fontSize(9).text(
        `This quote expires on ${new Date(data.expiresAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`,
        50, y, { align: "center" }
      );
    }

    const footerY = doc.page.height - 40;
    const footer = [data.companyName, data.companyPhone, data.companyEmail].filter(Boolean).join(" • ");
    doc.fillColor(MUTED).fontSize(8).text(footer, 50, footerY, { align: "center" });

    doc.end();
  });
}

export async function generateQuoteDocx(data: QuoteDocData): Promise<Buffer> {
  const fetchedImages = data.images && data.images.length > 0
    ? await fetchImageBuffers(data.images, data.baseUrl)
    : [];

  const freqLabel = frequencyLabel(data.frequency);

  const headerRows: Paragraph[] = [];
  if (data.propertyAddress) {
    headerRows.push(new Paragraph({
      children: [
        new TextRun({ text: "Property: ", color: "475569", size: 20 }),
        new TextRun({ text: data.propertyAddress, bold: true, color: "1e293b", size: 20 }),
      ],
      spacing: { after: 80 },
    }));
  }
  headerRows.push(new Paragraph({
    children: [
      new TextRun({ text: "Service Frequency: ", color: "475569", size: 20 }),
      new TextRun({ text: freqLabel, bold: true, color: "1e293b", size: 20 }),
    ],
    spacing: { after: 200 },
  }));

  const tiers = [
    { name: "Essential", price: data.essentialPrice, features: filterFeatures(data.essentialFeatures) },
    { name: "Property Care", price: data.premiumPrice, features: filterFeatures(data.premiumFeatures) },
    { name: "Deluxe", price: data.deluxePrice, features: filterFeatures(data.deluxeFeatures) },
  ];

  const tierTable = new Table({
    rows: [
      new TableRow({
        children: tiers.map(t => new TableCell({
          children: [new Paragraph({
            children: [new TextRun({ text: t.name, bold: true, color: "ffffff", size: 22 })],
            alignment: AlignmentType.CENTER,
          })],
          shading: { type: ShadingType.SOLID, color: "1a7a4c" },
          width: { size: 33, type: WidthType.PERCENTAGE },
        })),
      }),
      new TableRow({
        children: tiers.map(t => new TableCell({
          children: [new Paragraph({
            children: [new TextRun({ text: `$${t.price.toFixed(2)}/visit`, bold: true, color: "1a7a4c", size: 28 })],
            alignment: AlignmentType.CENTER,
            spacing: { before: 100, after: 100 },
          })],
          width: { size: 33, type: WidthType.PERCENTAGE },
        })),
      }),
      new TableRow({
        children: tiers.map(t => new TableCell({
          children: t.features.length > 0 ? t.features.map(f => new Paragraph({
            children: [new TextRun({ text: `✓ ${f}`, color: "475569", size: 18 })],
            spacing: { after: 40 },
          })) : [new Paragraph({ children: [] })],
          width: { size: 33, type: WidthType.PERCENTAGE },
        })),
      }),
    ],
    width: { size: 100, type: WidthType.PERCENTAGE },
  });

  const scopeParagraphs: Paragraph[] = [];
  if (data.type === "commercial" && data.breakdown) {
    const bd = data.breakdown;
    scopeParagraphs.push(new Paragraph({
      text: "Scope of Work",
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 300, after: 150 },
    }));
    const items: string[] = [];
    if (bd.stationCount > 0) {
      items.push(`Waste Stations: ${bd.stationCount} station${bd.stationCount !== 1 ? 's' : ''} maintained per visit`);
    }
    if (bd.commonAreaMinutes) items.push(`Common Area: ${bd.commonAreaMinutes} min`);
    if (bd.crewSize) items.push(`Crew Size: ${bd.crewSize} person(s)`);
    if (bd.totalLaborHours) {
      items.push(`On-Site Labor: ${bd.totalLaborHours} hrs with ${bd.crewSize || 1}-person crew`);
    }
    if (bd.mileageCost > 0) {
      items.push(`Travel: Included (${bd.mileageDistance || 0} mi round-trip)`);
    }
    if (bd.dumpFee > 0) {
      items.push(`Waste Disposal: Included`);
    }
    for (const item of items) {
      scopeParagraphs.push(new Paragraph({
        children: [new TextRun({ text: `• ${item}`, size: 20, color: "475569" })],
        spacing: { after: 60 },
      }));
    }
  }

  const imageParagraphs: Paragraph[] = [];
  if (fetchedImages.length > 0) {
    const sectionTitle = data.type === "commercial" ? "Site Overview" : "Property Measurement";
    imageParagraphs.push(new Paragraph({
      text: sectionTitle,
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 300, after: 150 },
    }));

    for (const img of fetchedImages) {
      const maxW = 500;
      const maxH = 350;
      const scale = Math.min(maxW / img.width, maxH / img.height, 1);
      const renderW = Math.round(img.width * scale);
      const renderH = Math.round(img.height * scale);

      const imgType = (img.buffer[0] === 0xFF && img.buffer[1] === 0xD8) ? "jpg" : "png";
      imageParagraphs.push(new Paragraph({
        children: [
          new ImageRun({
            data: img.buffer,
            transformation: { width: renderW, height: renderH },
            type: imgType as any,
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 60 },
      }));

      imageParagraphs.push(new Paragraph({
        children: [new TextRun({ text: img.caption, color: "64748b", size: 18, italics: true })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 150 },
      }));
    }
  }

  const notesParagraphs: Paragraph[] = [];
  if (data.notes) {
    notesParagraphs.push(new Paragraph({
      text: "Notes",
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 300, after: 100 },
    }));
    notesParagraphs.push(new Paragraph({
      children: [new TextRun({ text: data.notes, color: "475569", size: 20 })],
      spacing: { after: 100 },
    }));
  }

  const expiryParagraphs: Paragraph[] = [];
  if (data.expiresAt) {
    expiryParagraphs.push(new Paragraph({
      children: [new TextRun({
        text: `This quote expires on ${new Date(data.expiresAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`,
        italics: true, color: "94a3b8", size: 18,
      })],
      alignment: AlignmentType.CENTER,
      spacing: { before: 300 },
    }));
  }

  const initialCleanParagraphs: Paragraph[] = [];
  if (data.initialCleanFee > 0) {
    initialCleanParagraphs.push(new Paragraph({
      children: [new TextRun({
        text: `Initial Clean Fee: $${data.initialCleanFee.toFixed(2)} (one-time) — Covers first-visit deep clean for accumulated waste.`,
        bold: true, color: "92400e", size: 20,
      })],
      spacing: { before: 200, after: 100 },
    }));
  }

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: {
            top: convertInchesToTwip(0.75),
            bottom: convertInchesToTwip(0.75),
            left: convertInchesToTwip(0.75),
            right: convertInchesToTwip(0.75),
          },
        },
      },
      children: [
        new Paragraph({
          children: [new TextRun({ text: data.companyName, bold: true, color: "1a7a4c", size: 36 })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 60 },
        }),
        new Paragraph({
          children: [new TextRun({ text: `Service Quote #${data.quoteNumber}`, color: "64748b", size: 22 })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 300 },
        }),
        new Paragraph({
          children: [new TextRun({ text: "Prepared for", color: "64748b", size: 20 })],
          spacing: { after: 40 },
        }),
        new Paragraph({
          children: [new TextRun({ text: data.contactName, bold: true, color: "1e293b", size: 28 })],
          spacing: { after: 100 },
        }),
        ...headerRows,
        ...scopeParagraphs,
        new Paragraph({
          text: "Service Packages",
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 300, after: 200 },
        }),
        tierTable,
        ...initialCleanParagraphs,
        ...imageParagraphs,
        ...notesParagraphs,
        ...expiryParagraphs,
        new Paragraph({
          children: [new TextRun({
            text: [data.companyName, data.companyPhone, data.companyEmail].filter(Boolean).join(" • "),
            color: "94a3b8", size: 16,
          })],
          alignment: AlignmentType.CENTER,
          spacing: { before: 400 },
        }),
      ],
    }],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}
