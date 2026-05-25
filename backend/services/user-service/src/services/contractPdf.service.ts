import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';

const FONT_PATH =
  process.env.PDF_FONT_PATH ||
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';

export interface ContractPdfData {
  id: string;
  packageName?: string | null;
  sessionMode?: string | null;
  pricePerSession?: number | null;
  price?: number | null;
  totalSessions?: number;
  packageType?: string;
  startDate?: Date | null;
  clientInfo: { firstName: string; lastName: string; email: string };
  ptInfo: { firstName: string; lastName: string; email: string };
}

export async function generateContractPdf(contract: ContractPdfData): Promise<string> {
  const dir = path.join(process.cwd(), 'uploads', 'contracts');
  await fs.promises.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${contract.id}.pdf`);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });

    // Use Unicode font if available; fall back to built-in if font file is missing
    try {
      if (fs.existsSync(FONT_PATH)) {
        doc.registerFont('Regular', FONT_PATH);
        doc.font('Regular');
      }
    } catch {
      // built-in Helvetica — Vietnamese characters may not render
    }

    const writeStream = fs.createWriteStream(filePath);
    doc.pipe(writeStream);

    const testMode = process.env.DROPBOX_SIGN_TEST_MODE !== 'false';

    if (testMode) {
      doc
        .fontSize(9)
        .fillColor('red')
        .text(
          '⚠ CHU KY THU NGHIEM - KHONG CO GIA TRI PHAP LY PRODUCTION',
          { align: 'center' },
        )
        .fillColor('black')
        .moveDown(0.5);
    }

    doc.fontSize(18).text('HOP DONG HUAN LUYEN CA NHAN', { align: 'center' });
    doc.moveDown();

    doc
      .fontSize(12)
      .text('BEN A (KHACH HANG):')
      .text(`  Ho va ten: ${contract.clientInfo.firstName} ${contract.clientInfo.lastName}`)
      .text(`  Email: ${contract.clientInfo.email}`)
      .moveDown()
      .text('BEN B (HUAN LUYEN VIEN):')
      .text(`  Ho va ten: ${contract.ptInfo.firstName} ${contract.ptInfo.lastName}`)
      .text(`  Email: ${contract.ptInfo.email}`)
      .moveDown();

    doc.text('DIEU KHOAN HOP DONG:');
    doc.text(`  Goi tap: ${contract.packageName || 'Theo buoi'}`);

    const modeLabel =
      contract.sessionMode === 'ONLINE'
        ? 'Online qua video call'
        : contract.sessionMode === 'OFFLINE'
          ? 'Offline tai phong gym'
          : contract.sessionMode || 'Chua xac dinh';
    doc.text(`  Hinh thuc: ${modeLabel}`);

    if (contract.packageType === 'PACKAGE' && contract.price && contract.price > 0) {
      doc.text(`  Gia goi: ${contract.price.toLocaleString()} THB`);
      if (contract.totalSessions) {
        const perSess = contract.price / contract.totalSessions;
        doc.text(`  Gia moi buoi (tinh ra): ${Math.round(perSess).toLocaleString()} THB/buoi`);
      }
    } else if (contract.pricePerSession && contract.pricePerSession > 0) {
      doc.text(`  Gia moi buoi: ${contract.pricePerSession.toLocaleString()} THB/buoi`);
    }

    if (contract.totalSessions) {
      doc.text(`  So buoi: ${contract.totalSessions} buoi`);
    }

    if (contract.startDate) {
      doc.text(
        `  Ngay bat dau: ${new Date(contract.startDate).toLocaleDateString('vi-VN')}`,
      );
    }

    doc.moveDown(2);
    doc
      .fontSize(10)
      .text(
        'Hai ben da doc, hieu ro va dong y voi cac dieu khoan tren.',
        { align: 'center' },
      )
      .moveDown();

    if (testMode) {
      doc
        .fontSize(9)
        .fillColor('red')
        .text(
          '[TEST MODE] Chu ky nay khong co hieu luc phap ly. Chi su dung cho muc dich thu nghiem.',
          { align: 'center' },
        )
        .fillColor('black');
    }

    doc.end();
    writeStream.on('finish', () => resolve(filePath));
    writeStream.on('error', reject);
  });
}
