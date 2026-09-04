import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { isLambdaRuntime } from "../utils/runtime.util";
import { contractPdfKey, putPrivateObject } from "./s3-upload.service";

// Service runs via `tsx watch src/server.ts` — __dirname = source dir (src/services/)
// '../assets/fonts/' resolves to src/assets/fonts/ ✓
const FONT_PATH = path.join(__dirname, "../assets/fonts/NotoSans-Regular.ttf");
const FONT_BOLD_PATH = path.join(
  __dirname,
  "../assets/fonts/NotoSans-Bold.ttf",
);

function useFont(doc: PDFKit.PDFDocument, bold = false) {
  const fontPath = bold ? FONT_BOLD_PATH : FONT_PATH;
  try {
    if (fs.existsSync(fontPath)) {
      doc.font(fontPath);
      return;
    }
  } catch {
    // font file exists but invalid (e.g. corrupt/wrong format) — fall through
  }
  doc.font(bold ? "Helvetica-Bold" : "Helvetica");
}

export interface ContractPdfData {
  contractId: string;
  packageName: string;
  totalSessions: number;
  price: number | null;
  pricePerSession: number | null;
  startDate: Date | null;
  endDate: Date | null;
  terms: string | null;
  notes: string | null;
  clientName: string;
  clientEmail: string;
  ptName: string;
  ptEmail: string;
  createdAt: Date;
}

function drawContractPdf(doc: PDFKit.PDFDocument, data: ContractPdfData): void {
  const testMode = process.env.DROPBOX_SIGN_TEST_MODE === "true";
  if (testMode) {
    doc
      .fontSize(9)
      .fillColor("red")
      .text("[TEST MODE] - Chu ky nay khong co hieu luc phap ly", {
        align: "center",
      })
      .fillColor("black")
      .moveDown(0.5);
  }

  useFont(doc, true);
  doc.fontSize(18).text("COACHING CONTRACT", { align: "center" });
  doc.moveDown(0.5);
  useFont(doc);
  doc
    .fontSize(10)
    .text(`Contract ID: ${data.contractId}`, { align: "center" });
  doc.text(`Date: ${data.createdAt.toISOString().split("T")[0]}`, {
    align: "center",
  });
  doc.moveDown(1.5);

  useFont(doc, true);
  doc.fontSize(12).text("PARTIES");
  useFont(doc);
  doc.fontSize(10);
  doc.text(`Personal Trainer: ${data.ptName} (${data.ptEmail})`);
  doc.text(`Client: ${data.clientName} (${data.clientEmail})`);
  doc.moveDown(1);

  useFont(doc, true);
  doc.fontSize(12).text("PACKAGE DETAILS");
  useFont(doc);
  doc.fontSize(10);
  doc.text(`Package: ${data.packageName}`);
  doc.text(`Total Sessions: ${data.totalSessions}`);
  if (data.price != null)
    doc.text(`Total Price: ${data.price.toLocaleString()} VND`);
  if (data.pricePerSession != null)
    doc.text(
      `Price Per Session: ${data.pricePerSession.toLocaleString()} VND`,
    );
  if (data.startDate)
    doc.text(`Start Date: ${data.startDate.toISOString().split("T")[0]}`);
  if (data.endDate)
    doc.text(`End Date: ${data.endDate.toISOString().split("T")[0]}`);
  doc.moveDown(1);

  if (data.terms) {
    useFont(doc, true);
    doc.fontSize(12).text("TERMS & CONDITIONS");
    useFont(doc);
    doc.fontSize(10).text(data.terms, { width: 495 });
    doc.moveDown(1);
  }
  if (data.notes) {
    useFont(doc, true);
    doc.fontSize(12).text("NOTES");
    useFont(doc);
    doc.fontSize(10).text(data.notes, { width: 495 });
    doc.moveDown(1);
  }

  doc.moveDown(2);
  useFont(doc, true);
  doc.fontSize(12).text("SIGNATURES");
  doc.moveDown(1);
  const sigY = doc.y;
  useFont(doc);
  doc.fontSize(10);
  doc.text("Personal Trainer:", 50, sigY);
  doc.text("____________________________", 50, sigY + 20);
  doc.text(data.ptName, 50, sigY + 35);
  doc.text(`Email: ${data.ptEmail}`, 50, sigY + 48);
  doc.text("Client:", 300, sigY);
  doc.text("____________________________", 300, sigY + 20);
  doc.text(data.clientName, 300, sigY + 35);
  doc.text(`Email: ${data.clientEmail}`, 300, sigY + 48);
}

export async function renderContractPdfBuffer(data: ContractPdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    drawContractPdf(doc, data);
    doc.end();
  });
}

export async function generateContractPdf(
  data: ContractPdfData,
): Promise<string> {
  if (isLambdaRuntime() || process.env.USER_UPLOAD_BUCKET) {
    const body = await renderContractPdfBuffer(data);
    return putPrivateObject({
      key: contractPdfKey(data.contractId),
      body,
      contentType: "application/pdf",
    });
  }

  const relativePath = path.join(
    "uploads",
    "contracts",
    `${data.contractId}.pdf`,
  );
  const absDir = path.join(process.cwd(), "uploads", "contracts");
  if (!fs.existsSync(absDir)) fs.mkdirSync(absDir, { recursive: true });
  const absPath = path.join(process.cwd(), relativePath);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const stream = fs.createWriteStream(absPath);
    doc.pipe(stream);
    drawContractPdf(doc, data);
    doc.end();
    stream.on("finish", () => resolve(relativePath));
    stream.on("error", reject);
  });
}
