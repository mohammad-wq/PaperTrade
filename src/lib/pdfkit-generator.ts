import PDFDocument from "pdfkit";

export interface PdfDocumentItem {
  name: string;
  specs?: string | null;
  lot?: string | null;
  quantity: number;
  unit: string;
  unitPrice?: number | null;
  lineTotal?: number | null;
}

export interface PdfDocumentData {
  docType: string;
  docNumber: string;
  sequenceNo?: number | null;
  financialYearLabel?: string | null;
  date: string;
  partyLabel: string;
  partyName: string;
  walkInName?: string | null;
  partyAddress?: string | null;
  partyPhone?: string | null;
  locationName?: string | null;
  referenceNo?: string | null;
  items: PdfDocumentItem[];
  totalAmount?: number | null;
  amountPaid?: number | null;
  paymentMethod?: string | null;
  paymentSplits?: Array<{ method: string; amount: number; reference?: string | null }> | null;
  freightCharges?: number | null;
  notes?: string | null;
  deliveryDetails?: {
    vehicleNo?: string | null;
    driverName?: string | null;
    deliveredTo?: string | null;
    recipientName?: string | null;
  } | null;
  signatures?: { leftLabel: string; rightLabel: string } | null;
}

export interface PdfPaymentReceiptData {
  receiptNo: string;
  sequenceNo?: number | null;
  direction?: string;
  financialYearLabel?: string | null;
  date: string;
  partyName: string;
  partyType?: string;
  partyPhone?: string | null;
  partyAddress?: string | null;
  amount: number;
  remainingBalance?: number | null;
  method: string;
  notes?: string | null;
  invoiceNo?: string | null;
  createdByName?: string | null;
  splits?: Array<{ method: string; amount: number; reference?: string | null }>;
}

export interface PdfPartyStatementRow {
  date: string;
  referenceDocNo?: string | null;
  referenceType?: string | null;
  description: string;
  debit: number;
  credit: number;
  runningBalance: number;
  detailRows?: Array<{
    productName: string;
    quantity: number;
    unit: string;
    rate: number;
    amount: number;
  }>;
}

export interface PdfPartyStatementData {
  companyName?: string;
  companyAddress?: string;
  companyPhone?: string;
  companyEmail?: string;
  party: {
    id?: string;
    name: string;
    type: string;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    creditLimit?: number | null;
  };
  currentBalance: number;
  openingBalance?: number;
  openingBalanceSourceYear?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  ledgerRows: PdfPartyStatementRow[];
}

const formatMoney = (val?: number | null) => {
  if (typeof val !== "number" || isNaN(val)) return "0.00";
  return val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export function renderDocumentPdfKit(data: PdfDocumentData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const leftMargin = 28;
      const rightMargin = 567.28; // 595.28 - 28
      const contentWidth = rightMargin - leftMargin; // 539.28

      const doc = new PDFDocument({
        size: "A4",
        margins: { top: 20, bottom: 20, left: leftMargin, right: 28 },
        bufferPages: true,
        autoFirstPage: true,
      });

      const chunks: Buffer[] = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const companyName = process.env.BUSINESS_NAME || "PAPER TRADE CO.";
      const companyAddress = process.env.BUSINESS_ADDRESS || "Wholesale Paper Market, Station Road";
      const companyPhone = process.env.BUSINESS_PHONE || "+92-300-1234567";

      const isSale =
        data.docType.toLowerCase().includes("sale") || data.docType.toLowerCase() === "estimate";
      const printedHeading = isSale ? "ESTIMATE" : data.docType.toUpperCase();
      const displayDocNumber =
        typeof data.sequenceNo === "number" && data.sequenceNo > 0
          ? `#${String(data.sequenceNo).padStart(3, "0")}`
          : data.docNumber;

      const displayPartyName = data.walkInName
        ? `${data.partyName} (${data.walkInName})`
        : data.deliveryDetails?.recipientName
          ? `${data.partyName} (Attn: ${data.deliveryDetails.recipientName})`
          : data.partyName;

      const hasRates = data.items.some((i) => typeof i.unitPrice === "number" && !isNaN(i.unitPrice));
      const hasLots = data.items.some((i) => Boolean(i.lot));

      // 1. Header Section (Ultra-compact)
      let curY = 20;
      doc.font("Helvetica-Bold").fontSize(13).fillColor("#111827").text(companyName, leftMargin, curY, { lineBreak: false });

      // Heading on right
      doc.font("Helvetica-Bold").fontSize(12).fillColor("#000000").text(printedHeading, leftMargin, curY, {
        align: "right",
        width: contentWidth,
        lineBreak: false,
      });

      curY += 15;
      const subtitleText = `${companyAddress} | Ph: ${companyPhone}`;
      doc.font("Helvetica").fontSize(7).fillColor("#4b5563").text(subtitleText, leftMargin, curY, { lineBreak: false });

      let metaHeaderRight = `No: ${displayDocNumber} | Date: ${data.date}`;
      if (data.financialYearLabel) {
        metaHeaderRight += ` | FY: ${data.financialYearLabel}`;
      }
      doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#111827").text(metaHeaderRight, leftMargin, curY, {
        align: "right",
        width: contentWidth,
        lineBreak: false,
      });

      curY += 12;
      doc.strokeColor("#111827").lineWidth(0.8).moveTo(leftMargin, curY).lineTo(rightMargin, curY).stroke();

      // 2. Metadata Section (Party & Details)
      curY += 5;
      const halfWidth = contentWidth * 0.5;

      // Left Column: Party
      doc.font("Helvetica-Bold").fontSize(6.5).fillColor("#6b7280").text(data.partyLabel.toUpperCase(), leftMargin, curY, { lineBreak: false });
      let partyY = curY + 9;
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#111827").text(displayPartyName, leftMargin, partyY, { width: halfWidth - 10, lineBreak: false });
      partyY += 10;

      let contactParts: string[] = [];
      if (data.partyPhone) contactParts.push(`Ph: ${data.partyPhone}`);
      if (data.partyAddress) contactParts.push(data.partyAddress);
      if (contactParts.length > 0) {
        doc.font("Helvetica").fontSize(6.5).fillColor("#4b5563").text(contactParts.join(" | "), leftMargin, partyY, {
          width: halfWidth - 10,
          ellipsis: true,
          lineBreak: false,
        });
        partyY += 9;
      }

      // Right Column: Transaction Details
      const rightX = leftMargin + halfWidth + 10;
      const rightW = halfWidth - 10;
      doc.font("Helvetica-Bold").fontSize(6.5).fillColor("#6b7280").text("TRANSACTION PARTICULARS", rightX, curY, { lineBreak: false });
      let rightY = curY + 9;

      let detailsLine1: string[] = [];
      if (data.locationName) detailsLine1.push(`Loc: ${data.locationName}`);
      if (data.referenceNo) detailsLine1.push(`Ref: ${data.referenceNo}`);
      if (detailsLine1.length > 0) {
        doc.font("Helvetica").fontSize(7).fillColor("#111827").text(detailsLine1.join("  |  "), rightX, rightY, { width: rightW, lineBreak: false });
        rightY += 10;
      }

      let detailsLine2: string[] = [];
      if (data.deliveryDetails?.vehicleNo) detailsLine2.push(`Vehicle: ${data.deliveryDetails.vehicleNo}`);
      if (data.deliveryDetails?.driverName) detailsLine2.push(`Driver: ${data.deliveryDetails.driverName}`);
      if (data.deliveryDetails?.deliveredTo) detailsLine2.push(`To: ${data.deliveryDetails.deliveredTo}`);
      if (detailsLine2.length > 0) {
        doc.font("Helvetica").fontSize(7).fillColor("#111827").text(detailsLine2.join("  |  "), rightX, rightY, { width: rightW, lineBreak: false });
        rightY += 9;
      }

      curY = Math.max(partyY, rightY) + 3;
      doc.strokeColor("#e5e7eb").lineWidth(0.5).moveTo(leftMargin, curY).lineTo(rightMargin, curY).stroke();

      // 3. Line Items Table (Tight, clear rows)
      curY += 4;
      let tableY = curY;

      let cols: Array<{ key: string; label: string; width: number; align: "left" | "right" | "center" }> = [];
      if (hasRates) {
        cols = [
          { key: "num", label: "#", width: 22, align: "left" },
          { key: "desc", label: "Description", width: 180, align: "left" },
          { key: "specs", label: "Specifications", width: 105, align: "left" },
          { key: "qty", label: "Qty", width: 50, align: "right" },
          { key: "unit", label: "Unit", width: 42, align: "center" },
          { key: "rate", label: "Rate (PKR)", width: 65, align: "right" },
          { key: "total", label: "Amount (PKR)", width: 75.28, align: "right" },
        ];
      } else if (hasLots) {
        cols = [
          { key: "num", label: "#", width: 22, align: "left" },
          { key: "desc", label: "Description", width: 190, align: "left" },
          { key: "lot", label: "Warehouse Lot", width: 110, align: "left" },
          { key: "specs", label: "Specifications", width: 120, align: "left" },
          { key: "qty", label: "Quantity", width: 97.28, align: "right" },
        ];
      } else {
        cols = [
          { key: "num", label: "#", width: 25, align: "left" },
          { key: "desc", label: "Description", width: 240, align: "left" },
          { key: "specs", label: "Specifications", width: 154, align: "left" },
          { key: "qty", label: "Quantity", width: 120.28, align: "right" },
        ];
      }

      // Table Header Row
      const rowHeight = 13;
      doc.rect(leftMargin, tableY, contentWidth, rowHeight + 2).fill("#f3f4f6");
      doc.strokeColor("#111827").lineWidth(0.8).moveTo(leftMargin, tableY).lineTo(rightMargin, tableY).stroke();
      doc.moveTo(leftMargin, tableY + rowHeight + 2).lineTo(rightMargin, tableY + rowHeight + 2).stroke();

      let xPos = leftMargin;
      doc.font("Helvetica-Bold").fontSize(7).fillColor("#111827");
      for (const col of cols) {
        doc.text(col.label, xPos + 2, tableY + 3, { width: col.width - 4, align: col.align, lineBreak: false });
        xPos += col.width;
      }

      tableY += rowHeight + 3;

      // Table Rows
      let rowIdx = 0;
      for (const it of data.items) {
        // Page overflow check (only if really overflowing page boundary)
        if (tableY > 740) {
          doc.addPage();
          tableY = 24;
        }

        if (rowIdx % 2 === 1) {
          doc.rect(leftMargin, tableY, contentWidth, rowHeight).fill("#fafafa");
        }

        const rateVal = typeof it.unitPrice === "number" && !isNaN(it.unitPrice) ? it.unitPrice : 0;
        const lineVal =
          typeof it.lineTotal === "number" && !isNaN(it.lineTotal)
            ? it.lineTotal
            : Number(it.quantity || 0) * rateVal;

        xPos = leftMargin;
        for (const col of cols) {
          let val = "";
          let isBold = false;
          if (col.key === "num") val = String(rowIdx + 1);
          else if (col.key === "desc") {
            val = it.name || "—";
            isBold = true;
          } else if (col.key === "specs") val = it.specs || "—";
          else if (col.key === "lot") val = it.lot ? `Lot #${it.lot}` : "—";
          else if (col.key === "qty") {
            val = `${Number(it.quantity || 0).toLocaleString(undefined, { maximumFractionDigits: 4 })}${!hasRates ? ` ${it.unit || ""}` : ""}`;
            isBold = !hasRates;
          } else if (col.key === "unit") val = it.unit || "Unit";
          else if (col.key === "rate") val = formatMoney(rateVal);
          else if (col.key === "total") {
            val = formatMoney(lineVal);
            isBold = true;
          }

          doc
            .font(isBold ? "Helvetica-Bold" : "Helvetica")
            .fontSize(6.8)
            .fillColor("#111827")
            .text(val, xPos + 2, tableY + 2.5, {
              width: col.width - 4,
              align: col.align,
              ellipsis: true,
              lineBreak: false,
            });
          xPos += col.width;
        }

        tableY += rowHeight;
        rowIdx++;
      }

      doc.strokeColor("#111827").lineWidth(0.8).moveTo(leftMargin, tableY).lineTo(rightMargin, tableY).stroke();

      // 4. Notes & Summary Section (Directly underneath table)
      let summaryY = tableY + 5;
      let notesBottomY = summaryY;
      let sumBottomY = summaryY;

      const summaryWidth = 200;
      const notesWidth = contentWidth - summaryWidth - 15;

      // Left: Notes
      if (data.notes && data.notes.trim()) {
        doc.font("Helvetica-Bold").fontSize(6.5).fillColor("#6b7280").text("NOTES & TERMS:", leftMargin, summaryY, { lineBreak: false });
        doc.font("Helvetica").fontSize(6.5).fillColor("#374151");
        const noteHeight = doc.heightOfString(data.notes, { width: notesWidth });
        doc.text(data.notes, leftMargin, summaryY + 8, {
          width: notesWidth,
          lineBreak: true,
        });
        notesBottomY = summaryY + 8 + noteHeight + 4;
      }

      // Right: Summary figures
      if (typeof data.totalAmount === "number" && !isNaN(data.totalAmount)) {
        const sumX = rightMargin - summaryWidth;
        let sY = summaryY;

        const freight = typeof data.freightCharges === "number" ? Math.max(0, data.freightCharges) : 0;
        if (freight > 0) {
          doc.font("Helvetica").fontSize(7).fillColor("#4b5563").text("Subtotal:", sumX, sY, { lineBreak: false });
          doc.font("Helvetica").fontSize(7).fillColor("#111827").text(`PKR ${formatMoney(data.totalAmount - freight)}`, sumX, sY, { align: "right", width: summaryWidth, lineBreak: false });
          sY += 10;

          doc.font("Helvetica").fontSize(7).fillColor("#4b5563").text("Freight / Packing:", sumX, sY, { lineBreak: false });
          doc.font("Helvetica").fontSize(7).fillColor("#111827").text(`PKR ${formatMoney(freight)}`, sumX, sY, { align: "right", width: summaryWidth, lineBreak: false });
          sY += 10;
        }

        // Total Row
        doc.rect(sumX - 2, sY - 1, summaryWidth + 4, 14).fill("#f3f4f6");
        doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#000000").text("Total Amount:", sumX + 2, sY + 2, { lineBreak: false });
        doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#000000").text(`PKR ${formatMoney(data.totalAmount)}`, sumX, sY + 1.5, { align: "right", width: summaryWidth, lineBreak: false });
        sY += 16;

        const paid = typeof data.amountPaid === "number" ? data.amountPaid : 0;
        doc.font("Helvetica").fontSize(7).fillColor("#4b5563").text("Amount Paid:", sumX, sY, { lineBreak: false });
        doc.font("Helvetica").fontSize(7).fillColor("#111827").text(`PKR ${formatMoney(paid)}`, sumX, sY, { align: "right", width: summaryWidth, lineBreak: false });
        sY += 10;

        if (data.paymentSplits && data.paymentSplits.length > 0 && paid > 0) {
          const splitSummary = data.paymentSplits.map((sp) => `${sp.method}: ${formatMoney(sp.amount)}`).join(" | ");
          doc.font("Helvetica").fontSize(5.8).fillColor("#6b7280").text(`(${splitSummary})`, sumX, sY, { align: "right", width: summaryWidth, lineBreak: false });
          sY += 8;
        } else if (data.paymentMethod && paid > 0 && data.paymentMethod !== "CASH") {
          doc.font("Helvetica").fontSize(5.8).fillColor("#6b7280").text(`(Mode: ${data.paymentMethod})`, sumX, sY, { align: "right", width: summaryWidth, lineBreak: false });
          sY += 8;
        }

        const balance = Math.max(0, data.totalAmount - paid);
        doc.strokeColor("#9ca3af").lineWidth(0.5).moveTo(sumX, sY).lineTo(rightMargin, sY).stroke();
        sY += 2;
        doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#000000").text("Balance Due:", sumX, sY, { lineBreak: false });
        doc.font("Helvetica-Bold").fontSize(8).fillColor("#000000").text(`PKR ${formatMoney(balance)}`, sumX, sY, { align: "right", width: summaryWidth, lineBreak: false });
        sY += 12;

        sumBottomY = sY;
      }

      // 5. Signatures Block (Positioned directly below the invoice details, NOT at page bottom)
      const sigs = data.signatures || { leftLabel: "Prepared By", rightLabel: "Authorized Signature / Stamp" };
      let sigY = Math.max(notesBottomY, sumBottomY) + 24;

      // Only add page if content would physically run off A4 sheet
      if (sigY > 780) {
        doc.addPage();
        sigY = 30;
      }

      const sigWidth = 140;

      // Left signature
      doc.strokeColor("#4b5563").lineWidth(0.7).moveTo(leftMargin + 10, sigY).lineTo(leftMargin + 10 + sigWidth, sigY).stroke();
      doc.font("Helvetica-Bold").fontSize(6.5).fillColor("#374151").text(sigs.leftLabel, leftMargin + 10, sigY + 3, { width: sigWidth, align: "center", lineBreak: false });

      // Right: Stamp Area + Authorized Signature
      const sigRightX = rightMargin - sigWidth - 10;
      doc.strokeColor("#d1d5db").lineWidth(0.5).dash(2, { space: 2 }).rect(sigRightX, sigY - 20, sigWidth, 18).stroke();
      doc.undash();
      doc.font("Helvetica").fontSize(5.5).fillColor("#9ca3af").text("AFFIX STAMP HERE", sigRightX, sigY - 12, { width: sigWidth, align: "center", lineBreak: false });

      doc.strokeColor("#4b5563").lineWidth(0.7).moveTo(sigRightX, sigY).lineTo(sigRightX + sigWidth, sigY).stroke();
      doc.font("Helvetica-Bold").fontSize(6.5).fillColor("#374151").text(sigs.rightLabel, sigRightX, sigY + 3, { width: sigWidth, align: "center", lineBreak: false });

      // 6. Compact Footer line directly after signatures
      const footerY = sigY + 16;
      doc.strokeColor("#e5e7eb").lineWidth(0.5).moveTo(leftMargin, footerY).lineTo(rightMargin, footerY).stroke();
      doc.font("Helvetica").fontSize(6).fillColor("#9ca3af").text(`${companyName} • Computer-Generated Document`, leftMargin, footerY + 3, { lineBreak: false });
      doc.text(`Printed: ${data.date}`, leftMargin, footerY + 3, { align: "right", width: contentWidth, lineBreak: false });


      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

export function renderPaymentReceiptPdfKit(data: PdfPaymentReceiptData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const leftMargin = 28;
      const rightMargin = 567.28;
      const contentWidth = rightMargin - leftMargin;

      const doc = new PDFDocument({
        size: "A4",
        margins: { top: 20, bottom: 20, left: leftMargin, right: 28 },
        bufferPages: true,
        autoFirstPage: true,
      });

      const chunks: Buffer[] = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const companyName = process.env.BUSINESS_NAME || "PAPER TRADE CO.";
      const companyAddress = process.env.BUSINESS_ADDRESS || "Wholesale Paper Market, Station Road";
      const companyPhone = process.env.BUSINESS_PHONE || "+92-300-1234567";

      const isMoneyIn = data.direction === "IN" || (data.partyType || "").toUpperCase() === "CUSTOMER";
      const receiptTitle = isMoneyIn ? "OFFICIAL PAYMENT RECEIPT" : "PAYMENT DISBURSEMENT VOUCHER";
      const partyHeaderLabel = isMoneyIn ? "RECEIVED FROM (CUSTOMER)" : "PAID TO (SUPPLIER / PAYEE)";
      const displayReceiptNo =
        typeof data.sequenceNo === "number" && data.sequenceNo > 0
          ? `#${String(data.sequenceNo).padStart(3, "0")}`
          : data.receiptNo;

      // 1. Header
      let curY = 20;
      doc.font("Helvetica-Bold").fontSize(13).fillColor("#111827").text(companyName, leftMargin, curY, { lineBreak: false });
      doc.font("Helvetica-Bold").fontSize(11).fillColor("#000000").text(receiptTitle, leftMargin, curY, { align: "right", width: contentWidth, lineBreak: false });

      curY += 15;
      doc.font("Helvetica").fontSize(7).fillColor("#4b5563").text(`${companyAddress} | Ph: ${companyPhone}`, leftMargin, curY, { lineBreak: false });

      let metaRight = `Voucher: ${displayReceiptNo} | Date: ${data.date}`;
      if (data.financialYearLabel) metaRight += ` | FY: ${data.financialYearLabel}`;
      doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#111827").text(metaRight, leftMargin, curY, { align: "right", width: contentWidth, lineBreak: false });

      curY += 12;
      doc.strokeColor("#111827").lineWidth(0.8).moveTo(leftMargin, curY).lineTo(rightMargin, curY).stroke();

      // 2. Metadata Section (2-Column)
      curY += 5;
      const halfWidth = contentWidth * 0.5;

      doc.font("Helvetica-Bold").fontSize(6.5).fillColor("#6b7280").text(partyHeaderLabel, leftMargin, curY, { lineBreak: false });
      let partyY = curY + 9;
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#111827").text(data.partyName, leftMargin, partyY, { width: halfWidth - 10, lineBreak: false });
      partyY += 10;

      let contactParts: string[] = [];
      if (data.partyPhone) contactParts.push(`Ph: ${data.partyPhone}`);
      if (data.partyAddress) contactParts.push(data.partyAddress);
      if (contactParts.length > 0) {
        doc.font("Helvetica").fontSize(6.5).fillColor("#4b5563").text(contactParts.join(" | "), leftMargin, partyY, { width: halfWidth - 10, lineBreak: false, ellipsis: true });
        partyY += 9;
      }

      const rightX = leftMargin + halfWidth + 10;
      const rightW = halfWidth - 10;
      doc.font("Helvetica-Bold").fontSize(6.5).fillColor("#6b7280").text("TRANSACTION PARTICULARS", rightX, curY, { lineBreak: false });
      let rightY = curY + 9;

      const pType = isMoneyIn ? "Money In (Receipt)" : "Money Out (Disbursement)";
      doc.font("Helvetica").fontSize(7).fillColor("#111827").text(`Type: ${pType} | Mode: ${data.method}`, rightX, rightY, { width: rightW, lineBreak: false });
      rightY += 10;

      const alloc = data.invoiceNo ? `Against Invoice: ${data.invoiceNo}` : "Allocation: On Account Settlement";
      doc.font("Helvetica").fontSize(7).fillColor("#111827").text(alloc, rightX, rightY, { width: rightW, lineBreak: false });
      rightY += 9;

      curY = Math.max(partyY, rightY) + 3;
      doc.strokeColor("#e5e7eb").lineWidth(0.5).moveTo(leftMargin, curY).lineTo(rightMargin, curY).stroke();

      // 3. Compact Highlight Amount Box
      curY += 5;
      doc.rect(leftMargin, curY, contentWidth, 24).fillAndStroke("#f9fafb", "#000000");
      doc.font("Helvetica-Bold").fontSize(7).fillColor("#4b5563").text(
        isMoneyIn ? "TOTAL RECEIVED AMOUNT" : "TOTAL DISBURSED AMOUNT",
        leftMargin + 8,
        curY + 4,
        { lineBreak: false }
      );
      const modeStr = data.splits && data.splits.length > 0 ? data.splits.map((s) => s.method).join(", ") : data.method;
      doc.font("Helvetica").fontSize(6.5).fillColor("#374151").text(`Settlement: ${modeStr}`, leftMargin + 8, curY + 13, { lineBreak: false });

      doc.font("Helvetica-Bold").fontSize(13).fillColor("#000000").text(`PKR ${formatMoney(data.amount)}`, leftMargin, curY + 5, {
        align: "right",
        width: contentWidth - 8,
        lineBreak: false,
      });

      // 4. Splits / Particulars Table
      curY += 28;
      let tableY = curY;
      const rowHeight = 13;

      doc.rect(leftMargin, tableY, contentWidth, rowHeight + 2).fill("#f3f4f6");
      doc.strokeColor("#111827").lineWidth(0.8).moveTo(leftMargin, tableY).lineTo(rightMargin, tableY).stroke();
      doc.moveTo(leftMargin, tableY + rowHeight + 2).lineTo(rightMargin, tableY + rowHeight + 2).stroke();

      const splitCols = [
        { label: "#", width: 25, align: "left" as const },
        { label: "Description / Particulars", width: 235, align: "left" as const },
        { label: "Method", width: 75, align: "center" as const },
        { label: "Reference", width: 95, align: "left" as const },
        { label: "Amount (PKR)", width: 109.28, align: "right" as const },
      ];

      let xPos = leftMargin;
      doc.font("Helvetica-Bold").fontSize(7).fillColor("#111827");
      for (const col of splitCols) {
        doc.text(col.label, xPos + 2, tableY + 3, { width: col.width - 4, align: col.align, lineBreak: false });
        xPos += col.width;
      }
      tableY += rowHeight + 3;

      const splitsList =
        data.splits && data.splits.length > 0
          ? data.splits
          : [{ method: data.method, amount: data.amount, reference: displayReceiptNo }];

      let sIdx = 1;
      for (const s of splitsList) {
        const desc = data.invoiceNo
          ? `${isMoneyIn ? "Receipt towards" : "Payment against"} ${data.invoiceNo}`
          : `${isMoneyIn ? "Receipt on account" : "Payment on account"} - ${data.partyName}`;

        xPos = leftMargin;
        doc.font("Helvetica").fontSize(6.8).fillColor("#111827").text(String(sIdx), xPos + 2, tableY + 2.5, { width: 21, align: "left", lineBreak: false });
        xPos += 25;

        doc.font("Helvetica-Bold").text(desc, xPos + 2, tableY + 2.5, { width: 231, align: "left", ellipsis: true, lineBreak: false });
        xPos += 235;

        doc.font("Helvetica").text(s.method, xPos + 2, tableY + 2.5, { width: 71, align: "center", lineBreak: false });
        xPos += 75;

        doc.text(s.reference || "—", xPos + 2, tableY + 2.5, { width: 91, align: "left", ellipsis: true, lineBreak: false });
        xPos += 95;

        doc.font("Helvetica-Bold").text(formatMoney(s.amount), xPos + 2, tableY + 2.5, { width: 105.28, align: "right", lineBreak: false });
        tableY += rowHeight;
        sIdx++;
      }

      doc.strokeColor("#111827").lineWidth(0.8).moveTo(leftMargin, tableY).lineTo(rightMargin, tableY).stroke();

      // 5. Remarks & Balances
      let sumY = tableY + 5;
      let notesBottomY = sumY;
      const sumW = 200;
      const notesWidth = contentWidth - sumW - 15;

      if (data.notes && data.notes.trim()) {
        doc.font("Helvetica-Bold").fontSize(6.5).fillColor("#6b7280").text("REMARKS:", leftMargin, sumY, { lineBreak: false });
        doc.font("Helvetica").fontSize(6.5).fillColor("#374151");
        const noteH = doc.heightOfString(data.notes, { width: notesWidth });
        doc.text(data.notes, leftMargin, sumY + 8, { width: notesWidth, lineBreak: true });
        notesBottomY = sumY + 8 + noteH + 4;
      }

      const sumX = rightMargin - sumW;
      doc.font("Helvetica").fontSize(7).fillColor("#4b5563").text("Total Settled:", sumX, sumY, { lineBreak: false });
      doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#111827").text(`PKR ${formatMoney(data.amount)}`, sumX, sumY, { align: "right", width: sumW, lineBreak: false });
      sumY += 10;

      if (data.remainingBalance != null) {
        doc.strokeColor("#9ca3af").lineWidth(0.5).moveTo(sumX, sumY).lineTo(rightMargin, sumY).stroke();
        sumY += 2;
        doc.font("Helvetica-Bold").fontSize(7).fillColor("#000000").text("Remaining Balance:", sumX, sumY, { lineBreak: false });
        const balLabel =
          data.remainingBalance > 0
            ? isMoneyIn ? "(Dr - Owes you)" : "(Cr - You owe)"
            : data.remainingBalance < 0
              ? isMoneyIn ? "(Cr - Advance)" : "(Dr - Advance)"
              : "(Settled)";
        doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#000000").text(`PKR ${formatMoney(Math.abs(data.remainingBalance))} ${balLabel}`, sumX, sumY, {
          align: "right",
          width: sumW,
          lineBreak: false,
        });
        sumY += 10;
      }

      // 6. Signatures & Stamp (Directly beneath details)
      let sigY = Math.max(notesBottomY, sumY) + 24;
      const sigWidth = 140;

      // Left: Authorized Cashier signature
      doc.strokeColor("#4b5563").lineWidth(0.7).moveTo(leftMargin + 10, sigY).lineTo(leftMargin + 10 + sigWidth, sigY).stroke();
      doc.font("Helvetica-Bold").fontSize(6.5).fillColor("#374151").text("Authorized Cashier / Accounts", leftMargin + 10, sigY + 3, { width: sigWidth, align: "center", lineBreak: false });

      // Right: Stamp Area + Payee/Customer Signature
      const sigRightX = rightMargin - sigWidth - 10;
      doc.strokeColor("#d1d5db").lineWidth(0.5).dash(2, { space: 2 }).rect(sigRightX, sigY - 20, sigWidth, 18).stroke();
      doc.undash();
      doc.font("Helvetica").fontSize(5.5).fillColor("#9ca3af").text("AFFIX STAMP HERE", sigRightX, sigY - 12, { width: sigWidth, align: "center", lineBreak: false });

      doc.strokeColor("#4b5563").lineWidth(0.7).moveTo(sigRightX, sigY).lineTo(sigRightX + sigWidth, sigY).stroke();
      doc.font("Helvetica-Bold").fontSize(6.5).fillColor("#374151").text("Payee / Customer Signature", sigRightX, sigY + 3, { width: sigWidth, align: "center", lineBreak: false });

      // 7. Footer
      const footerY = sigY + 16;
      doc.strokeColor("#e5e7eb").lineWidth(0.5).moveTo(leftMargin, footerY).lineTo(rightMargin, footerY).stroke();
      doc.font("Helvetica").fontSize(6).fillColor("#9ca3af").text(`${companyName} • Official Payment Voucher`, leftMargin, footerY + 3, { lineBreak: false });
      doc.text(`Printed: ${data.date}`, leftMargin, footerY + 3, { align: "right", width: contentWidth, lineBreak: false });


      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

export function renderPartyStatementPdfKit(data: PdfPartyStatementData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const leftMargin = 28;
      const rightMargin = 567.28;
      const contentWidth = rightMargin - leftMargin; // 539.28

      const doc = new PDFDocument({
        size: "A4",
        margins: { top: 24, bottom: 36, left: leftMargin, right: 28 },
        bufferPages: true,
        autoFirstPage: true,
      });

      const chunks: Buffer[] = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const companyName = data.companyName || process.env.BUSINESS_NAME || "PAPER TRADE CO.";
      const companyAddress = data.companyAddress || process.env.BUSINESS_ADDRESS || "Wholesale Paper Market, Station Road";
      const companyPhone = data.companyPhone || process.env.BUSINESS_PHONE || "+92-300-1234567";

      const safeOpeningBalance = typeof data.openingBalance === "number" && !isNaN(data.openingBalance) ? data.openingBalance : 0;
      const safeCurrentBalance = typeof data.currentBalance === "number" && !isNaN(data.currentBalance) ? data.currentBalance : 0;
      const rows = Array.isArray(data.ledgerRows) ? data.ledgerRows : [];

      const totalDebits = rows.reduce((sum, r) => sum + (Number(r.debit) || 0), 0);
      const totalCredits = rows.reduce((sum, r) => sum + (Number(r.credit) || 0), 0);

      const colW = { date: 54, ref: 70, desc: 196, debit: 68, credit: 68, bal: 83.28 };
      const colX = {
        date: leftMargin,
        ref: leftMargin + colW.date,
        desc: leftMargin + colW.date + colW.ref,
        debit: leftMargin + colW.date + colW.ref + colW.desc,
        credit: leftMargin + colW.date + colW.ref + colW.desc + colW.debit,
        bal: leftMargin + colW.date + colW.ref + colW.desc + colW.debit + colW.credit,
      };

      // Helper to draw table header
      const drawTableHeader = (y: number): number => {
        doc.rect(leftMargin, y, contentWidth, 18).fill("#0f172a");
        doc.font("Helvetica-Bold").fontSize(7).fillColor("#ffffff");
        
        doc.text("DATE", colX.date + 4, y + 5, { width: colW.date - 6, lineBreak: false });
        doc.text("TRAN # / REF", colX.ref + 4, y + 5, { width: colW.ref - 6, lineBreak: false });
        doc.text("PARTICULARS / DESCRIPTION", colX.desc + 4, y + 5, { width: colW.desc - 6, lineBreak: false });
        doc.text("DEBIT (PKR)", colX.debit, y + 5, { width: colW.debit - 4, align: "right", lineBreak: false });
        doc.text("CREDIT (PKR)", colX.credit, y + 5, { width: colW.credit - 4, align: "right", lineBreak: false });
        doc.text("BALANCE (PKR)", colX.bal, y + 5, { width: colW.bal - 4, align: "right", lineBreak: false });

        return y + 18;
      };

      // 1. Brand & Header Block
      let y = 24;
      doc.font("Helvetica-Bold").fontSize(13).fillColor("#0f172a").text(companyName, leftMargin, y, { lineBreak: false });
      doc.font("Helvetica").fontSize(7).fillColor("#475569");
      doc.text(`${companyAddress}  •  Phone: ${companyPhone}`, leftMargin, y + 16, { lineBreak: false });

      // Right title banner
      doc.font("Helvetica-Bold").fontSize(13).fillColor("#0284c7").text("STATEMENT OF ACCOUNT", leftMargin, y, {
        align: "right",
        width: contentWidth,
        lineBreak: false,
      });
      const periodLabel = `Period: ${data.startDate || "Beginning"} to ${data.endDate || "Present"}`;
      doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#334155").text(periodLabel, leftMargin, y + 16, {
        align: "right",
        width: contentWidth,
        lineBreak: false,
      });

      y += 32;
      doc.strokeColor("#cbd5e1").lineWidth(0.8).moveTo(leftMargin, y).lineTo(rightMargin, y).stroke();
      y += 8;

      // 2. Account Details & KPI Cards Summary
      const cardHeight = 44;
      const cardGap = 6;
      const partyBoxWidth = 230;
      const kpiBoxWidth = (contentWidth - partyBoxWidth - cardGap * 3) / 3;

      // Party Info Card
      doc.rect(leftMargin, y, partyBoxWidth, cardHeight).fillAndStroke("#f8fafc", "#e2e8f0");
      doc.font("Helvetica-Bold").fontSize(6.5).fillColor("#64748b").text("ACCOUNT INFORMATION", leftMargin + 8, y + 5, { lineBreak: false });
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#0f172a").text(`${data.party.name} (${data.party.type})`, leftMargin + 8, y + 15, { width: partyBoxWidth - 16, lineBreak: false });
      const meta = [data.party.phone ? `Ph: ${data.party.phone}` : null, data.party.address ? `Addr: ${data.party.address}` : null].filter(Boolean).join("  |  ") || "Contact: On file";
      doc.font("Helvetica").fontSize(6.5).fillColor("#475569").text(meta, leftMargin + 8, y + 27, { width: partyBoxWidth - 16, lineBreak: false });

      // Opening Balance Card
      let kpiX = leftMargin + partyBoxWidth + cardGap;
      doc.rect(kpiX, y, kpiBoxWidth, cardHeight).fillAndStroke("#f8fafc", "#e2e8f0");
      doc.font("Helvetica-Bold").fontSize(6.5).fillColor("#64748b").text("OPENING BALANCE", kpiX + 6, y + 5, { lineBreak: false });
      const opLabel = safeOpeningBalance >= 0 ? "Dr (Receivable)" : "Cr (Payable)";
      doc.font("Helvetica-Bold").fontSize(8).fillColor(safeOpeningBalance >= 0 ? "#0369a1" : "#b45309").text(`PKR ${formatMoney(Math.abs(safeOpeningBalance))}`, kpiX + 6, y + 16, { lineBreak: false });
      doc.font("Helvetica").fontSize(6).fillColor("#64748b").text(opLabel, kpiX + 6, y + 28, { lineBreak: false });

      // Total Activity Card (Debits / Credits)
      kpiX += kpiBoxWidth + cardGap;
      doc.rect(kpiX, y, kpiBoxWidth, cardHeight).fillAndStroke("#f8fafc", "#e2e8f0");
      doc.font("Helvetica-Bold").fontSize(6.5).fillColor("#64748b").text("TOTAL TRANSACTIONS", kpiX + 6, y + 5, { lineBreak: false });
      doc.font("Helvetica").fontSize(6.5).fillColor("#166534").text(`Total Dr: PKR ${formatMoney(totalDebits)}`, kpiX + 6, y + 16, { lineBreak: false });
      doc.font("Helvetica").fontSize(6.5).fillColor("#991b1b").text(`Total Cr: PKR ${formatMoney(totalCredits)}`, kpiX + 6, y + 27, { lineBreak: false });

      // Closing Balance Card (Highlighted)
      kpiX += kpiBoxWidth + cardGap;
      const isDue = safeCurrentBalance > 0;
      doc.rect(kpiX, y, kpiBoxWidth, cardHeight).fillAndStroke(isDue ? "#eff6ff" : "#f0fdf4", isDue ? "#93c5fd" : "#86efac");
      doc.font("Helvetica-Bold").fontSize(6.5).fillColor(isDue ? "#1d4ed8" : "#15803d").text("CLOSING BALANCE", kpiX + 6, y + 5, { lineBreak: false });
      const curLabel = safeCurrentBalance > 0 ? "Dr (Owes You)" : safeCurrentBalance < 0 ? "Cr (Advance/You Owe)" : "Settled (0.00)";
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor(isDue ? "#1e40af" : "#166534").text(`PKR ${formatMoney(Math.abs(safeCurrentBalance))}`, kpiX + 6, y + 16, { lineBreak: false });
      doc.font("Helvetica-Bold").fontSize(6).fillColor(isDue ? "#1e40af" : "#166534").text(curLabel, kpiX + 6, y + 28, { lineBreak: false });

      y += cardHeight + 12;

      // 3. Transactions Ledger Table
      y = drawTableHeader(y);

      // Row 0: Opening Balance Brought Forward
      doc.rect(leftMargin, y, contentWidth, 16).fill("#fffbeb");
      doc.strokeColor("#fed7aa").lineWidth(0.5).moveTo(leftMargin, y + 16).lineTo(rightMargin, y + 16).stroke();
      doc.font("Helvetica-Bold").fontSize(6.5).fillColor("#78350f");
      doc.text(data.startDate || "—", colX.date + 4, y + 4, { width: colW.date - 6, lineBreak: false });
      doc.text("B/F", colX.ref + 4, y + 4, { width: colW.ref - 6, lineBreak: false });
      doc.text("Balance Brought Forward", colX.desc + 4, y + 4, { width: colW.desc - 6, lineBreak: false });
      if (safeOpeningBalance >= 0) {
        doc.text(formatMoney(Math.abs(safeOpeningBalance)), colX.debit, y + 4, { width: colW.debit - 4, align: "right", lineBreak: false });
        doc.text("—", colX.credit, y + 4, { width: colW.credit - 4, align: "right", lineBreak: false });
      } else {
        doc.text("—", colX.debit, y + 4, { width: colW.debit - 4, align: "right", lineBreak: false });
        doc.text(formatMoney(Math.abs(safeOpeningBalance)), colX.credit, y + 4, { width: colW.credit - 4, align: "right", lineBreak: false });
      }
      const bwdDrCr = safeOpeningBalance >= 0 ? "Dr" : "Cr";
      doc.text(`${formatMoney(Math.abs(safeOpeningBalance))} ${bwdDrCr}`, colX.bal, y + 4, { width: colW.bal - 4, align: "right", lineBreak: false });
      y += 16;

      // Render Transaction Rows
      if (rows.length === 0) {
        doc.rect(leftMargin, y, contentWidth, 24).fill("#ffffff");
        doc.font("Helvetica").fontSize(7.5).fillColor("#94a3b8").text("No transactions recorded for this period.", leftMargin, y + 8, {
          width: contentWidth,
          align: "center",
          lineBreak: false,
        });
        y += 24;
      } else {
        for (let idx = 0; idx < rows.length; idx++) {
          const r = rows[idx];
          const hasDetails = Array.isArray(r.detailRows) && r.detailRows.length > 0;
          const detailHeight = hasDetails ? 16 + (r.detailRows!.length * 11) : 0;
          const rowHeight = 16 + detailHeight;

          // Page boundary check
          if (y + rowHeight > 780) {
            doc.addPage();
            y = 28;
            y = drawTableHeader(y);
          }

          // Alternating background
          const rowBg = idx % 2 === 1 ? "#f8fafc" : "#ffffff";
          doc.rect(leftMargin, y, contentWidth, rowHeight).fill(rowBg);

          // Top line of row
          doc.font("Helvetica").fontSize(6.5).fillColor("#334155");
          doc.text(r.date, colX.date + 4, y + 4, { width: colW.date - 6, lineBreak: false });

          const refText = r.referenceDocNo || r.referenceType || "—";
          doc.font("Helvetica-Bold").fontSize(6.5).fillColor("#0f172a");
          doc.text(refText, colX.ref + 4, y + 4, { width: colW.ref - 6, lineBreak: false });

          doc.text(r.description, colX.desc + 4, y + 4, { width: colW.desc - 8, lineBreak: false });

          doc.font("Helvetica").fontSize(6.5).fillColor("#0f172a");
          doc.text(r.debit > 0 ? formatMoney(r.debit) : "—", colX.debit, y + 4, { width: colW.debit - 4, align: "right", lineBreak: false });
          doc.text(r.credit > 0 ? formatMoney(r.credit) : "—", colX.credit, y + 4, { width: colW.credit - 4, align: "right", lineBreak: false });

          const drCr = r.runningBalance >= 0 ? "Dr" : "Cr";
          doc.font("Helvetica-Bold").fontSize(6.5).fillColor("#0f172a");
          doc.text(`${formatMoney(Math.abs(r.runningBalance))} ${drCr}`, colX.bal, y + 4, { width: colW.bal - 4, align: "right", lineBreak: false });

          // Render itemized detail sub-table if attached
          if (hasDetails) {
            let subY = y + 16;
            const subBoxX = colX.desc + 4;
            const subBoxW = colW.desc + colW.debit + colW.credit + colW.bal - 12;

            doc.rect(subBoxX, subY, subBoxW, detailHeight - 4).fillAndStroke("#f1f5f9", "#cbd5e1");

            // Sub-header
            doc.font("Helvetica-Bold").fontSize(5.5).fillColor("#475569");
            doc.text("ITEM DESCRIPTION", subBoxX + 4, subY + 3, { width: 140, lineBreak: false });
            doc.text("QUANTITY", subBoxX + 148, subY + 3, { width: 60, align: "right", lineBreak: false });
            doc.text("UNIT RATE", subBoxX + 212, subY + 3, { width: 60, align: "right", lineBreak: false });
            doc.text("AMOUNT (PKR)", subBoxX + 276, subY + 3, { width: 70, align: "right", lineBreak: false });
            subY += 10;
            doc.strokeColor("#cbd5e1").lineWidth(0.5).moveTo(subBoxX, subY).lineTo(subBoxX + subBoxW, subY).stroke();

            for (const item of r.detailRows!) {
              doc.font("Helvetica").fontSize(5.5).fillColor("#1e293b");
              doc.text(item.productName, subBoxX + 4, subY + 2, { width: 140, lineBreak: false });
              doc.text(`${item.quantity} ${item.unit}`, subBoxX + 148, subY + 2, { width: 60, align: "right", lineBreak: false });
              doc.text(formatMoney(item.rate), subBoxX + 212, subY + 2, { width: 60, align: "right", lineBreak: false });
              doc.font("Helvetica-Bold").fontSize(5.5).fillColor("#0f172a");
              doc.text(formatMoney(item.amount), subBoxX + 276, subY + 2, { width: 70, align: "right", lineBreak: false });
              subY += 10;
            }
          }

          // Row separator line
          doc.strokeColor("#e2e8f0").lineWidth(0.5).moveTo(leftMargin, y + rowHeight).lineTo(rightMargin, y + rowHeight).stroke();
          y += rowHeight;
        }
      }

      // 4. Totals Footer Row
      if (y + 22 > 780) {
        doc.addPage();
        y = 28;
      }
      doc.rect(leftMargin, y, contentWidth, 20).fill("#f1f5f9");
      doc.strokeColor("#0f172a").lineWidth(1).moveTo(leftMargin, y).lineTo(rightMargin, y).stroke();
      doc.strokeColor("#0f172a").lineWidth(1).moveTo(leftMargin, y + 20).lineTo(rightMargin, y + 20).stroke();

      doc.font("Helvetica-Bold").fontSize(7).fillColor("#0f172a");
      doc.text("TOTAL TRANSACTIONS & CLOSING BALANCE:", leftMargin + 6, y + 6, { width: colW.date + colW.ref + colW.desc - 10, lineBreak: false });
      doc.text(formatMoney(totalDebits), colX.debit, y + 6, { width: colW.debit - 4, align: "right", lineBreak: false });
      doc.text(formatMoney(totalCredits), colX.credit, y + 6, { width: colW.credit - 4, align: "right", lineBreak: false });

      const finalDrCr = safeCurrentBalance >= 0 ? "Dr" : "Cr";
      doc.text(`${formatMoney(Math.abs(safeCurrentBalance))} ${finalDrCr}`, colX.bal, y + 6, { width: colW.bal - 4, align: "right", lineBreak: false });

      // 5. Multi-page footer labeling
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        doc.strokeColor("#cbd5e1").lineWidth(0.5).moveTo(leftMargin, 812).lineTo(rightMargin, 812).stroke();
        doc.font("Helvetica").fontSize(6).fillColor("#64748b");
        doc.text(`${companyName}  •  Certified Party Statement Ledger  •  Generated: ${new Date().toLocaleString()}`, leftMargin, 816, { lineBreak: false });
        doc.text(`Page ${i + 1} of ${range.count}`, leftMargin, 816, { align: "right", width: contentWidth, lineBreak: false });
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

export interface PdfGeneralLedgerEntry {
  date: string;
  accountType?: string;
  partyName?: string;
  voucherType?: string;
  docNo?: string;
  description: string;
  debit: number;
  credit: number;
  runningBalance: number;
}

export interface PdfGeneralLedgerData {
  companyName?: string;
  companyAddress?: string;
  companyPhone?: string;
  companyEmail?: string;
  period?: string;
  filterInfo?: string;
  openingBalance: number;
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
  entries: PdfGeneralLedgerEntry[];
}

export function renderGeneralLedgerPdfKit(data: PdfGeneralLedgerData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const leftMargin = 28;
      const rightMargin = 813.89; // 841.89 - 28
      const contentWidth = 785.89;

      const doc = new PDFDocument({
        size: "A4",
        layout: "landscape",
        margins: { top: 24, bottom: 36, left: leftMargin, right: 28 },
        bufferPages: true,
        autoFirstPage: true,
      });

      const chunks: Buffer[] = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const companyName = data.companyName || process.env.BUSINESS_NAME || "PAPER TRADE CO.";
      const companyAddress = data.companyAddress || process.env.BUSINESS_ADDRESS || "Wholesale Paper Market, Station Road";
      const companyPhone = data.companyPhone || process.env.BUSINESS_PHONE || "+92-300-1234567";

      const safeOpeningBalance = Number(data.openingBalance) || 0;
      const safeTotalDebit = Number(data.totalDebit) || 0;
      const safeTotalCredit = Number(data.totalCredit) || 0;
      const safeClosingBalance = Number(data.closingBalance) || (safeOpeningBalance + safeTotalDebit - safeTotalCredit);
      const rows = Array.isArray(data.entries) ? data.entries : [];

      const colW = { date: 65, acct: 130, desc: 230, voucher: 110, debit: 80, credit: 80, bal: 90.89 };
      const colX = {
        date: leftMargin,
        acct: leftMargin + colW.date,
        desc: leftMargin + colW.date + colW.acct,
        voucher: leftMargin + colW.date + colW.acct + colW.desc,
        debit: leftMargin + colW.date + colW.acct + colW.desc + colW.voucher,
        credit: leftMargin + colW.date + colW.acct + colW.desc + colW.voucher + colW.debit,
        bal: leftMargin + colW.date + colW.acct + colW.desc + colW.voucher + colW.debit + colW.credit,
      };

      const drawTableHeader = (y: number): number => {
        doc.rect(leftMargin, y, contentWidth, 18).fill("#0f172a");
        doc.font("Helvetica-Bold").fontSize(7).fillColor("#ffffff");

        doc.text("DATE", colX.date + 4, y + 5, { width: colW.date - 6, lineBreak: false });
        doc.text("ACCOUNT / PARTY", colX.acct + 4, y + 5, { width: colW.acct - 6, lineBreak: false });
        doc.text("PARTICULARS / DESCRIPTION", colX.desc + 4, y + 5, { width: colW.desc - 6, lineBreak: false });
        doc.text("VOUCHER & DOC #", colX.voucher + 4, y + 5, { width: colW.voucher - 6, lineBreak: false });
        doc.text("DEBIT (PKR)", colX.debit, y + 5, { width: colW.debit - 4, align: "right", lineBreak: false });
        doc.text("CREDIT (PKR)", colX.credit, y + 5, { width: colW.credit - 4, align: "right", lineBreak: false });
        doc.text("BALANCE (PKR)", colX.bal, y + 5, { width: colW.bal - 4, align: "right", lineBreak: false });

        return y + 18;
      };

      // 1. Company Brand Header
      let y = 24;
      doc.font("Times-Bold").fontSize(18).fillColor("#0f172a").text(companyName.toUpperCase(), leftMargin, y);
      doc.font("Helvetica").fontSize(7.5).fillColor("#475569").text(`${companyAddress}  •  Tel: ${companyPhone}`, leftMargin, y + 20);

      // Report Header on Right
      doc.font("Helvetica-Bold").fontSize(14).fillColor("#0f172a").text("GENERAL LEDGER", leftMargin, y, { align: "right", width: contentWidth });
      doc.font("Helvetica").fontSize(8).fillColor("#475569").text(`Period: ${data.period || "All Time"}`, leftMargin, y + 18, { align: "right", width: contentWidth });
      if (data.filterInfo) {
        doc.font("Helvetica-Oblique").fontSize(7.5).fillColor("#64748b").text(`Filters: ${data.filterInfo}`, leftMargin, y + 29, { align: "right", width: contentWidth });
      }

      y += 44;
      doc.strokeColor("#0f172a").lineWidth(1.2).moveTo(leftMargin, y).lineTo(rightMargin, y).stroke();
      y += 8;

      // 2. KPI Summary Cards
      const cardWidth = (contentWidth - 18) / 4;
      const kpis = [
        { label: "OPENING BALANCE (B/F)", val: `${formatMoney(Math.abs(safeOpeningBalance))} ${safeOpeningBalance >= 0 ? "Dr" : "Cr"}`, color: "#0f172a", bg: "#f8fafc" },
        { label: "TOTAL DEBITS (DR)", val: `PKR ${formatMoney(safeTotalDebit)}`, color: "#065f46", bg: "#f0fdf4" },
        { label: "TOTAL CREDITS (CR)", val: `PKR ${formatMoney(safeTotalCredit)}`, color: "#9a3412", bg: "#fffbeb" },
        { label: "CLOSING BALANCE", val: `${formatMoney(Math.abs(safeClosingBalance))} ${safeClosingBalance >= 0 ? "Dr" : "Cr"}`, color: safeClosingBalance >= 0 ? "#065f46" : "#991b1b", bg: safeClosingBalance >= 0 ? "#ecfdf5" : "#fef2f2" },
      ];

      kpis.forEach((k, idx) => {
        const cx = leftMargin + idx * (cardWidth + 6);
        doc.rect(cx, y, cardWidth, 32).fillAndStroke(k.bg, "#cbd5e1");
        doc.font("Helvetica-Bold").fontSize(6.5).fillColor("#64748b").text(k.label, cx + 6, y + 5, { width: cardWidth - 12, lineBreak: false });
        doc.font("Helvetica-Bold").fontSize(10).fillColor(k.color).text(k.val, cx + 6, y + 16, { width: cardWidth - 12, lineBreak: false });
      });

      y += 38;

      // 3. Table Header
      y = drawTableHeader(y);

      // 4. Ledger rows
      if (rows.length === 0) {
        doc.rect(leftMargin, y, contentWidth, 24).fillAndStroke("#ffffff", "#e2e8f0");
        doc.font("Helvetica").fontSize(8).fillColor("#64748b").text("No general ledger records found matching the applied criteria.", leftMargin, y + 8, { align: "center", width: contentWidth });
        y += 24;
      } else {
        rows.forEach((row, idx) => {
          if (y > 520) {
            doc.addPage();
            y = drawTableHeader(24);
          }

          const rowBg = idx % 2 === 0 ? "#ffffff" : "#f8fafc";
          const rowH = 18;
          doc.rect(leftMargin, y, contentWidth, rowH).fill(rowBg);

          doc.font("Helvetica").fontSize(7).fillColor("#334155");
          doc.text(row.date, colX.date + 4, y + 5, { width: colW.date - 6, lineBreak: false });

          doc.font("Helvetica-Bold").fontSize(7).fillColor("#0f172a");
          doc.text(row.partyName || row.accountType || "—", colX.acct + 4, y + 5, { width: colW.acct - 6, lineBreak: false });

          doc.font("Helvetica").fontSize(7).fillColor("#334155");
          doc.text(row.description || "—", colX.desc + 4, y + 5, { width: colW.desc - 6, lineBreak: false });

          doc.font("Helvetica").fontSize(6.5).fillColor("#64748b");
          const voucherStr = `${row.voucherType || ""} ${row.docNo || ""}`.trim() || "—";
          doc.text(voucherStr, colX.voucher + 4, y + 5, { width: colW.voucher - 6, lineBreak: false });

          doc.font("Helvetica").fontSize(7).fillColor("#065f46");
          doc.text(row.debit > 0 ? formatMoney(row.debit) : "—", colX.debit, y + 5, { width: colW.debit - 4, align: "right", lineBreak: false });

          doc.font("Helvetica").fontSize(7).fillColor("#9a3412");
          doc.text(row.credit > 0 ? formatMoney(row.credit) : "—", colX.credit, y + 5, { width: colW.credit - 4, align: "right", lineBreak: false });

          const balDrCr = row.runningBalance >= 0 ? "Dr" : "Cr";
          doc.font("Helvetica-Bold").fontSize(7).fillColor("#0f172a");
          doc.text(`${formatMoney(Math.abs(row.runningBalance))} ${balDrCr}`, colX.bal, y + 5, { width: colW.bal - 4, align: "right", lineBreak: false });

          // Subtle horizontal divider
          doc.strokeColor("#e2e8f0").lineWidth(0.5).moveTo(leftMargin, y + rowH).lineTo(rightMargin, y + rowH).stroke();

          y += rowH;
        });
      }

      // 5. Totals Row
      if (y > 520) {
        doc.addPage();
        y = drawTableHeader(24);
      }

      doc.rect(leftMargin, y, contentWidth, 20).fill("#f1f5f9");
      doc.strokeColor("#0f172a").lineWidth(1).moveTo(leftMargin, y).lineTo(rightMargin, y).stroke();
      doc.strokeColor("#0f172a").lineWidth(1).moveTo(leftMargin, y + 20).lineTo(rightMargin, y + 20).stroke();

      doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#0f172a");
      doc.text("TOTAL AUDIT ACTIVITY & CLOSING POSITION", colX.date + 4, y + 6, { width: colW.date + colW.acct + colW.desc + colW.voucher - 8, lineBreak: false });

      doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#065f46");
      doc.text(formatMoney(safeTotalDebit), colX.debit, y + 6, { width: colW.debit - 4, align: "right", lineBreak: false });

      doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#9a3412");
      doc.text(formatMoney(safeTotalCredit), colX.credit, y + 6, { width: colW.credit - 4, align: "right", lineBreak: false });

      const finalDrCr = safeClosingBalance >= 0 ? "Dr" : "Cr";
      doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#0f172a");
      doc.text(`${formatMoney(Math.abs(safeClosingBalance))} ${finalDrCr}`, colX.bal, y + 6, { width: colW.bal - 4, align: "right", lineBreak: false });

      // 6. Multi-page footer labeling
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        doc.strokeColor("#cbd5e1").lineWidth(0.5).moveTo(leftMargin, 565).lineTo(rightMargin, 565).stroke();
        doc.font("Helvetica").fontSize(6.5).fillColor("#64748b");
        doc.text(`${companyName}  •  General Ledger Audit Report  •  Generated: ${new Date().toLocaleString()}`, leftMargin, 570, { lineBreak: false });
        doc.text(`Page ${i + 1} of ${range.count}`, leftMargin, 570, { align: "right", width: contentWidth, lineBreak: false });
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

