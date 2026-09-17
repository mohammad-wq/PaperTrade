import React from "react";
import path from "path";
import { renderToFile } from "@react-pdf/renderer";
import { DocumentPdfView } from "../src/pdf/documents";

async function main() {
  const sampleInvoice = React.createElement(DocumentPdfView, {
    docType: "Sale Invoice",
    docNumber: "2026-0001",
    financialYearLabel: "2026-2027",
    date: "16/09/2026",
    partyLabel: "Bill To (Customer)",
    partyName: "Crown Packages & Printing Ltd.",
    partyAddress: "Plot 45, Sector 12-A, Korangi Industrial Area, Karachi",
    partyPhone: "+92-321-9876543",
    locationName: "Main Warehouse (Site I)",
    referenceNo: "DO: 2026-0004",
    totalAmount: 184500,
    amountPaid: 84500,
    notes: "1. Payment terms: Net 15 days from the date of invoice.\n2. Goods once sold will not be returned without prior written approval and physical inspection.\n3. Overdue payments are subject to standard commercial mark-up.",
    signatures: {
      leftLabel: "Prepared & Checked By",
      rightLabel: "Authorized Signatory",
    },
    items: [
      {
        name: "Art Card 300 GSM (Imported Grade A)",
        specs: '25"x36" | 300 GSM',
        quantity: 120,
        unit: "PACKET",
        unitPrice: 850,
        lineTotal: 102000,
      },
      {
        name: "Offset Printing Paper 70 GSM (Century)",
        specs: '23"x36" | 70 GSM',
        quantity: 75,
        unit: "REAM",
        unitPrice: 900,
        lineTotal: 67500,
      },
      {
        name: "Kraft Liner Board 150 GSM",
        specs: '28"x40" | 150 GSM',
        quantity: 30,
        unit: "PACKET",
        unitPrice: 500,
        lineTotal: 15000,
      },
    ],
  });

  const outPdf = path.resolve(__dirname, "reference_invoice.pdf");
  await renderToFile(sampleInvoice, outPdf);
  console.log("SUCCESS: Rendered reference invoice to", outPdf);
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});

