import React from "react";
import { Document, Page, Text, View, StyleSheet, Font } from "@react-pdf/renderer";

// Prevent hyphenation crashes and prevent words/numbers from breaking across lines
Font.registerHyphenationCallback((word) => [word]);

const formatMoney = (val?: number | null) => {
  if (typeof val !== "number" || isNaN(val)) return "0.00";
  return val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 48,
    paddingHorizontal: 40,
    fontSize: 8.5,
    fontFamily: "Helvetica",
    color: "#111827",
    lineHeight: 1.35,
  },
  // Top Header Block
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 1.5,
    borderBottomColor: "#111827",
    paddingBottom: 10,
    marginBottom: 12,
  },
  brandBox: {
    width: "55%",
  },
  brandName: {
    fontSize: 19,
    fontFamily: "Times-Bold",
    color: "#000000",
    letterSpacing: 0.3,
    marginBottom: 4,
  },
  brandMeta: {
    fontSize: 8,
    fontFamily: "Helvetica",
    color: "#374151",
    marginTop: 1,
    lineHeight: 1.35,
  },
  docTitleBox: {
    width: "45%",
    alignItems: "flex-end",
  },
  docTitle: {
    fontSize: 16,
    fontFamily: "Times-Bold",
    color: "#000000",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  docNumberRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 3,
  },
  docNumberLabel: {
    fontSize: 8.5,
    fontFamily: "Helvetica-Bold",
    color: "#374151",
    textTransform: "uppercase",
    marginRight: 4,
  },
  docNumber: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: "#000000",
  },
  docMeta: {
    fontSize: 8,
    fontFamily: "Helvetica",
    color: "#374151",
    marginTop: 1.5,
  },
  // 2-Column Metadata Section
  metaSection: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 0.75,
    borderBottomColor: "#d1d5db",
    paddingBottom: 10,
    marginBottom: 12,
  },
  metaPartyCol: {
    width: "54%",
  },
  metaDetailsCol: {
    width: "42%",
  },
  sectionHeading: {
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
    color: "#4b5563",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 3,
  },
  metaPartyName: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: "#000000",
    marginBottom: 2,
  },
  metaPartyText: {
    fontSize: 8,
    fontFamily: "Helvetica",
    color: "#374151",
    lineHeight: 1.3,
  },
  metaKeyValueRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 1,
  },
  metaKey: {
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
    color: "#4b5563",
    textTransform: "uppercase",
  },
  metaVal: {
    fontSize: 8,
    fontFamily: "Helvetica",
    color: "#111827",
    textAlign: "right",
  },
  // Itemized Table
  table: {
    marginBottom: 10,
    borderTopWidth: 1,
    borderTopColor: "#111827",
    borderBottomWidth: 1,
    borderBottomColor: "#111827",
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#f9fafb",
    borderBottomWidth: 1,
    borderBottomColor: "#111827",
    paddingVertical: 4.5,
    paddingHorizontal: 4,
    alignItems: "center",
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: "#e5e7eb",
    paddingVertical: 4.5,
    paddingHorizontal: 4,
    backgroundColor: "#ffffff",
    alignItems: "center",
  },
  tableRowAlternate: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: "#e5e7eb",
    paddingVertical: 4.5,
    paddingHorizontal: 4,
    backgroundColor: "#fafafa",
    alignItems: "center",
  },
  // Column Widths with rates (sum = 100%)
  colIndex: { width: "5%" },
  colProduct: { width: "37%", paddingRight: 4 },
  colSpecs: { width: "20%", paddingRight: 4 },
  colQty: { width: "11%", textAlign: "right" },
  colUnit: { width: "9%", textAlign: "center" },
  colRate: { width: "9%", textAlign: "right" },
  colTotal: { width: "9%", textAlign: "right" },

  // Column Widths without rates (e.g. Delivery Order) (sum = 100%)
  colIndexFull: { width: "6%" },
  colProductFull: { width: "48%", paddingRight: 6 },
  colSpecsFull: { width: "28%", paddingRight: 6 },
  colQtyFull: { width: "18%", textAlign: "right" },

  // Column Widths for Delivery Order / Dispatch with Lot (sum = 100%)
  colIndexDo: { width: "6%" },
  colProductDo: { width: "38%", paddingRight: 6 },
  colLotDo: { width: "20%", paddingRight: 4 },
  colSpecsDo: { width: "20%", paddingRight: 4 },
  colQtyDo: { width: "16%", textAlign: "right" },

  headerCell: {
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
    color: "#000000",
    textTransform: "uppercase",
  },
  headerCellCenter: {
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
    color: "#000000",
    textTransform: "uppercase",
    textAlign: "center",
  },
  headerCellRight: {
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
    color: "#000000",
    textTransform: "uppercase",
    textAlign: "right",
  },
  cellIndex: {
    fontSize: 8,
    fontFamily: "Helvetica",
    color: "#4b5563",
  },
  cellText: {
    fontSize: 8,
    fontFamily: "Helvetica",
    color: "#111827",
  },
  cellTextBold: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#000000",
  },
  cellRight: {
    fontSize: 8,
    fontFamily: "Helvetica",
    color: "#111827",
    textAlign: "right",
  },
  cellCenter: {
    fontSize: 8,
    fontFamily: "Helvetica",
    color: "#111827",
    textAlign: "center",
  },
  cellBoldRight: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#000000",
    textAlign: "right",
  },

  // Bottom Section: Notes on Left, Summary on Right
  bottomSection: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 20,
  },
  notesCol: {
    width: "52%",
    paddingRight: 10,
  },
  notesHeading: {
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
    color: "#4b5563",
    textTransform: "uppercase",
    marginBottom: 2,
  },
  notesBody: {
    fontSize: 7.5,
    fontFamily: "Helvetica",
    color: "#374151",
    lineHeight: 1.35,
  },
  summaryCol: {
    width: "42%",
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 2,
  },
  summaryLabel: {
    fontSize: 8,
    fontFamily: "Helvetica",
    color: "#374151",
  },
  summaryValue: {
    fontSize: 8.5,
    fontFamily: "Helvetica-Bold",
    color: "#000000",
  },
  grandTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: "#000000",
    borderBottomWidth: 1.5,
    borderBottomColor: "#000000",
    paddingVertical: 3.5,
    marginTop: 3,
  },
  grandTotalLabel: {
    fontSize: 8.5,
    fontFamily: "Helvetica-Bold",
    color: "#000000",
    textTransform: "uppercase",
  },
  grandTotalValue: {
    fontSize: 10.5,
    fontFamily: "Helvetica-Bold",
    color: "#000000",
  },

  // Signature Block: Simple formal lines
  signaturesRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 26,
    paddingHorizontal: 8,
  },
  sigBlock: {
    width: "42%",
  },
  sigLine: {
    borderTopWidth: 1,
    borderTopColor: "#000000",
    paddingTop: 4,
  },
  sigTitle: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#111827",
    textAlign: "center",
    textTransform: "uppercase",
  },

  // Footer
  footer: {
    position: "absolute",
    bottom: 22,
    left: 40,
    right: 40,
    borderTopWidth: 0.5,
    borderTopColor: "#9ca3af",
    paddingTop: 5,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7,
    fontFamily: "Helvetica",
    color: "#6b7280",
  },
});

type ItemRow = {
  name: string;
  specs?: string;
  lot?: string | null;
  quantity: number;
  unit: string;
  unitPrice?: number;
  lineTotal?: number;
};

export function DocumentPdfView({
  docType,
  docNumber,
  sequenceNo,
  date,
  partyLabel,
  partyName,
  walkInName,
  partyAddress,
  partyPhone,
  locationName,
  referenceNo,
  items,
  totalAmount,
  amountPaid,
  freightCharges,
  financialYearLabel,
  notes,
  deliveryDetails,
  signatures,
}: {
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
  locationName?: string;
  referenceNo?: string | null;
  items: ItemRow[];
  totalAmount?: number;
  amountPaid?: number;
  freightCharges?: number;
  notes?: string | null;
  deliveryDetails?: {
    vehicleNo?: string | null;
    driverName?: string | null;
    deliveredTo?: string | null;
    recipientName?: string | null;
  };
  signatures?: { leftLabel: string; rightLabel: string };
}) {
  const companyName = process.env.BUSINESS_NAME || "PAPER TRADE CO.";
  const companyAddress = process.env.BUSINESS_ADDRESS || "Wholesale Paper Market, Station Road";
  const companyPhone = process.env.BUSINESS_PHONE || "+92-300-1234567";

  const isSaleInvoice =
    docType.toLowerCase().includes("sale") || docType.toLowerCase() === "estimate";
  const printedHeading = isSaleInvoice ? "Estimate" : docType;
  const displayDocNumber =
    typeof sequenceNo === "number" && sequenceNo > 0
      ? `#${String(sequenceNo).padStart(3, "0")}`
      : docNumber;

  const displayPartyName = walkInName
    ? `${partyName} (${walkInName})`
    : deliveryDetails?.recipientName
      ? `${partyName} (Attn: ${deliveryDetails.recipientName})`
      : partyName;

  const hasRates = items.some((i) => typeof i.unitPrice === "number" && !isNaN(i.unitPrice));
  const isDeliveryOrder =
    docType.toLowerCase().includes("delivery") || docType.toLowerCase().includes("transfer");
  const hasLots = isDeliveryOrder || items.some((i) => Boolean(i.lot));

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Brand Header */}
        <View style={styles.headerRow}>
          <View style={styles.brandBox}>
            <Text style={styles.brandName}>{companyName}</Text>
            <View style={{ marginTop: 5 }}>
              <Text style={styles.brandMeta}>{companyAddress}</Text>
              <Text style={styles.brandMeta}>Phone: {companyPhone}</Text>
            </View>
          </View>
          <View style={styles.docTitleBox}>
            <Text style={styles.docTitle}>{printedHeading}</Text>
            <View style={styles.docNumberRow}>
              <Text style={styles.docNumberLabel}>No:</Text>
              <Text style={styles.docNumber}>{displayDocNumber}</Text>
            </View>
            <Text style={styles.docMeta}>Date: {date}</Text>
            {financialYearLabel ? (
              <Text style={styles.docMeta}>Financial Year: {financialYearLabel}</Text>
            ) : null}
            {referenceNo ? <Text style={styles.docMeta}>Ref: {referenceNo}</Text> : null}
          </View>
        </View>

        {/* Party and Location Information */}
        <View style={styles.metaSection}>
          <View style={styles.metaPartyCol}>
            <Text style={styles.sectionHeading}>{partyLabel}</Text>
            <Text style={styles.metaPartyName}>{displayPartyName}</Text>
            {partyAddress ? <Text style={styles.metaPartyText}>{partyAddress}</Text> : null}
            {partyPhone ? <Text style={styles.metaPartyText}>Phone: {partyPhone}</Text> : null}
          </View>
          <View style={styles.metaDetailsCol}>
            <Text style={styles.sectionHeading}>Transaction Information</Text>
            {locationName ? (
              <View style={styles.metaKeyValueRow}>
                <Text style={styles.metaKey}>Location:</Text>
                <Text style={styles.metaVal}>{locationName}</Text>
              </View>
            ) : null}
            {referenceNo ? (
              <View style={styles.metaKeyValueRow}>
                <Text style={styles.metaKey}>Reference:</Text>
                <Text style={styles.metaVal}>{referenceNo}</Text>
              </View>
            ) : null}
            {deliveryDetails?.vehicleNo ? (
              <View style={styles.metaKeyValueRow}>
                <Text style={styles.metaKey}>Vehicle No:</Text>
                <Text style={styles.metaVal}>{deliveryDetails.vehicleNo}</Text>
              </View>
            ) : null}
            {deliveryDetails?.driverName ? (
              <View style={styles.metaKeyValueRow}>
                <Text style={styles.metaKey}>Driver Name:</Text>
                <Text style={styles.metaVal}>{deliveryDetails.driverName}</Text>
              </View>
            ) : null}
            {deliveryDetails?.recipientName ? (
              <View style={styles.metaKeyValueRow}>
                <Text style={styles.metaKey}>Recipient:</Text>
                <Text style={styles.metaVal}>{deliveryDetails.recipientName}</Text>
              </View>
            ) : null}
            {deliveryDetails?.deliveredTo ? (
              <View style={styles.metaKeyValueRow}>
                <Text style={styles.metaKey}>Delivered To:</Text>
                <Text style={styles.metaVal}>{deliveryDetails.deliveredTo}</Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* Line Items Table */}
        <View style={styles.table}>
          {hasRates ? (
            <View style={styles.tableHeader}>
              <Text style={[styles.colIndex, styles.headerCell]}>#</Text>
              <Text style={[styles.colProduct, styles.headerCell]}>Description</Text>
              <Text style={[styles.colSpecs, styles.headerCell]}>Specifications</Text>
              <Text style={[styles.colQty, styles.headerCellRight]}>Qty</Text>
              <Text style={[styles.colUnit, styles.headerCellCenter]}>Unit</Text>
              <Text style={[styles.colRate, styles.headerCellRight]}>Rate (PKR)</Text>
              <Text style={[styles.colTotal, styles.headerCellRight]}>Amount (PKR)</Text>
            </View>
          ) : hasLots ? (
            <View style={styles.tableHeader}>
              <Text style={[styles.colIndexDo, styles.headerCell]}>#</Text>
              <Text style={[styles.colProductDo, styles.headerCell]}>Description</Text>
              <Text style={[styles.colLotDo, styles.headerCell]}>Warehouse Lot</Text>
              <Text style={[styles.colSpecsDo, styles.headerCell]}>Specifications</Text>
              <Text style={[styles.colQtyDo, styles.headerCellRight]}>Quantity</Text>
            </View>
          ) : (
            <View style={styles.tableHeader}>
              <Text style={[styles.colIndexFull, styles.headerCell]}>#</Text>
              <Text style={[styles.colProductFull, styles.headerCell]}>Description</Text>
              <Text style={[styles.colSpecsFull, styles.headerCell]}>Specifications</Text>
              <Text style={[styles.colQtyFull, styles.headerCellRight]}>Quantity</Text>
            </View>
          )}

          {items.map((item, idx) => {
            const hasRate = typeof item.unitPrice === "number" && !isNaN(item.unitPrice);
            const rateVal = hasRate ? item.unitPrice! : 0;
            const lineVal =
              typeof item.lineTotal === "number" && !isNaN(item.lineTotal)
                ? item.lineTotal
                : Number(item.quantity || 0) * rateVal;

            const isAlt = idx % 2 === 1;

            if (hasRates) {
              return (
                <View key={idx} style={isAlt ? styles.tableRowAlternate : styles.tableRow}>
                  <Text style={[styles.colIndex, styles.cellIndex]}>{idx + 1}</Text>
                  <Text style={[styles.colProduct, styles.cellTextBold]}>{item.name || "—"}</Text>
                  <Text style={[styles.colSpecs, styles.cellText]}>{item.specs || "—"}</Text>
                  <Text style={[styles.colQty, styles.cellRight]}>
                    {Number(item.quantity || 0).toLocaleString(undefined, { maximumFractionDigits: 4 })}
                  </Text>
                  <Text style={[styles.colUnit, styles.cellCenter]}>{item.unit || "Unit"}</Text>
                  <Text style={[styles.colRate, styles.cellRight]}>{formatMoney(rateVal)}</Text>
                  <Text style={[styles.colTotal, styles.cellBoldRight]}>{formatMoney(lineVal)}</Text>
                </View>
              );
            }

            if (hasLots) {
              return (
                <View key={idx} style={isAlt ? styles.tableRowAlternate : styles.tableRow}>
                  <Text style={[styles.colIndexDo, styles.cellIndex]}>{idx + 1}</Text>
                  <Text style={[styles.colProductDo, styles.cellTextBold]}>{item.name || "—"}</Text>
                  <Text style={[styles.colLotDo, styles.cellTextBold]}>
                    {item.lot ? `Lot #${item.lot}` : "—"}
                  </Text>
                  <Text style={[styles.colSpecsDo, styles.cellText]}>{item.specs || "—"}</Text>
                  <Text style={[styles.colQtyDo, styles.cellBoldRight]}>
                    {Number(item.quantity || 0).toLocaleString(undefined, { maximumFractionDigits: 4 })} {item.unit || ""}
                  </Text>
                </View>
              );
            }

            return (
              <View key={idx} style={isAlt ? styles.tableRowAlternate : styles.tableRow}>
                <Text style={[styles.colIndexFull, styles.cellIndex]}>{idx + 1}</Text>
                <Text style={[styles.colProductFull, styles.cellTextBold]}>{item.name || "—"}</Text>
                <Text style={[styles.colSpecsFull, styles.cellText]}>{item.specs || "—"}</Text>
                <Text style={[styles.colQtyFull, styles.cellBoldRight]}>
                  {Number(item.quantity || 0).toLocaleString(undefined, { maximumFractionDigits: 4 })} {item.unit || ""}
                </Text>
              </View>
            );
          })}
        </View>

        {/* Bottom Section: Notes & Summary */}
        <View style={styles.bottomSection}>
          <View style={styles.notesCol}>
            {notes ? (
              <View>
                <Text style={styles.notesHeading}>Notes & Terms</Text>
                <Text style={styles.notesBody}>{notes}</Text>
              </View>
            ) : null}
          </View>

          {typeof totalAmount === "number" && !isNaN(totalAmount) ? (
            <View style={styles.summaryCol}>
              {typeof freightCharges === "number" && freightCharges > 0 ? (
                <>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Subtotal:</Text>
                    <Text style={styles.summaryValue}>
                      PKR {formatMoney(totalAmount - freightCharges)}
                    </Text>
                  </View>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Freight / Packing:</Text>
                    <Text style={styles.summaryValue}>PKR {formatMoney(freightCharges)}</Text>
                  </View>
                </>
              ) : null}
              <View style={styles.grandTotalRow}>
                <Text style={styles.grandTotalLabel}>Total Amount:</Text>
                <Text style={styles.grandTotalValue}>PKR {formatMoney(totalAmount)}</Text>
              </View>
              {/* Always display 3 figures summary block, even when zero */}
              <View style={[styles.summaryRow, { marginTop: 4 }]}>
                <Text style={styles.summaryLabel}>Amount Paid:</Text>
                <Text style={styles.summaryValue}>PKR {formatMoney(amountPaid || 0)}</Text>
              </View>
              <View
                style={[
                  styles.summaryRow,
                  { borderTopWidth: 0.75, borderTopColor: "#000000", paddingTop: 3, marginTop: 2 },
                ]}
              >
                <Text style={[styles.summaryLabel, { fontFamily: "Helvetica-Bold", color: "#000000" }]}>
                  Balance Due:
                </Text>
                <Text style={[styles.summaryValue, { fontFamily: "Helvetica-Bold", color: "#000000" }]}>
                  PKR {formatMoney(Math.max(0, totalAmount - (amountPaid || 0)))}
                </Text>
              </View>
            </View>
          ) : null}
        </View>

        {/* Signatures */}
        {signatures ? (
          <View style={styles.signaturesRow}>
            <View style={styles.sigBlock}>
              <View style={styles.sigLine}>
                <Text style={styles.sigTitle}>{signatures.leftLabel}</Text>
              </View>
            </View>
            <View style={styles.sigBlock}>
              <View style={styles.sigLine}>
                <Text style={styles.sigTitle}>{signatures.rightLabel}</Text>
              </View>
            </View>
          </View>
        ) : null}

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text>{companyName} — Official Document</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export function PaymentReceiptPdfView({
  receiptNo,
  sequenceNo,
  direction = "IN",
  financialYearLabel,
  date,
  partyName,
  partyType,
  partyPhone,
  partyAddress,
  amount,
  remainingBalance,
  method,
  notes,
  invoiceNo,
  createdByName,
  splits,
}: {
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
}) {
  const companyName = process.env.BUSINESS_NAME || "PAPER TRADE CO.";
  const companyAddress = process.env.BUSINESS_ADDRESS || "Wholesale Paper Market, Station Road";
  const companyPhone = process.env.BUSINESS_PHONE || "+92-300-1234567";

  const isMoneyIn = direction === "IN" || (partyType || "").toUpperCase() === "CUSTOMER";
  const receiptTitle = isMoneyIn ? "Official Payment Receipt" : "Payment Disbursement Voucher";
  const partyHeaderLabel = isMoneyIn ? "Received From (Customer)" : "Paid To (Supplier / Payee)";
  const displayReceiptNo =
    typeof sequenceNo === "number" && sequenceNo > 0
      ? `#${String(sequenceNo).padStart(3, "0")}`
      : receiptNo;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Brand Header */}
        <View style={styles.headerRow}>
          <View style={styles.brandBox}>
            <Text style={styles.brandName}>{companyName}</Text>
            <View style={{ marginTop: 5 }}>
              <Text style={styles.brandMeta}>{companyAddress}</Text>
              <Text style={styles.brandMeta}>Phone: {companyPhone}</Text>
            </View>
          </View>
          <View style={styles.docTitleBox}>
            <Text style={styles.docTitle}>{receiptTitle}</Text>
            <View style={styles.docNumberRow}>
              <Text style={styles.docNumberLabel}>Voucher No:</Text>
              <Text style={styles.docNumber}>{displayReceiptNo}</Text>
            </View>
            <Text style={styles.docMeta}>Date: {date}</Text>
            {financialYearLabel ? (
              <Text style={styles.docMeta}>Financial Year: {financialYearLabel}</Text>
            ) : null}
          </View>
        </View>

        {/* 2-Column Meta Section */}
        <View style={styles.metaSection}>
          <View style={styles.metaPartyCol}>
            <Text style={styles.sectionHeading}>{partyHeaderLabel}</Text>
            <Text style={styles.metaPartyName}>{partyName}</Text>
            {partyAddress ? <Text style={styles.metaPartyText}>{partyAddress}</Text> : null}
            {partyPhone ? <Text style={styles.metaPartyText}>Phone: {partyPhone}</Text> : null}
          </View>
          <View style={styles.metaDetailsCol}>
            <Text style={styles.sectionHeading}>Transaction Particulars</Text>
            <View style={styles.metaKeyValueRow}>
              <Text style={styles.metaKey}>Transaction Type:</Text>
              <Text style={styles.metaVal}>{isMoneyIn ? "Money In (Receipt)" : "Money Out (Disbursement)"}</Text>
            </View>
            <View style={styles.metaKeyValueRow}>
              <Text style={styles.metaKey}>Primary Mode:</Text>
              <Text style={styles.metaVal}>{method}</Text>
            </View>
            {invoiceNo ? (
              <View style={styles.metaKeyValueRow}>
                <Text style={styles.metaKey}>Against Invoice:</Text>
                <Text style={styles.metaVal}>{invoiceNo}</Text>
              </View>
            ) : (
              <View style={styles.metaKeyValueRow}>
                <Text style={styles.metaKey}>Allocation:</Text>
                <Text style={styles.metaVal}>On Account Settlement</Text>
              </View>
            )}
            {createdByName ? (
              <View style={styles.metaKeyValueRow}>
                <Text style={styles.metaKey}>Processed By:</Text>
                <Text style={styles.metaVal}>{createdByName}</Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* Amount Highlight Box */}
        <View
          style={{
            borderWidth: 1.25,
            borderColor: "#000000",
            backgroundColor: "#f9fafb",
            paddingVertical: 12,
            paddingHorizontal: 16,
            marginBottom: 16,
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <View>
            <Text style={{ fontSize: 8, fontFamily: "Helvetica-Bold", color: "#4b5563", textTransform: "uppercase" }}>
              {isMoneyIn ? "Total Received Amount" : "Total Disbursed Amount"}
            </Text>
            <Text style={{ fontSize: 9, fontFamily: "Helvetica", color: "#374151", marginTop: 2 }}>
              Mode of Settlement: {splits && splits.length > 0 ? splits.map((s) => s.method).join(", ") : method}
            </Text>
          </View>
          <Text style={{ fontSize: 18, fontFamily: "Times-Bold", color: "#000000" }}>
            PKR {formatMoney(amount)}
          </Text>
        </View>

        {/* Line Table */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[{ width: "6%" }, styles.headerCell]}>#</Text>
            <Text style={[{ width: "44%", paddingRight: 4 }, styles.headerCell]}>Description / Particulars</Text>
            <Text style={[{ width: "15%" }, styles.headerCellCenter]}>Method</Text>
            <Text style={[{ width: "17%", paddingRight: 4 }, styles.headerCell]}>Reference</Text>
            <Text style={[{ width: "18%" }, styles.headerCellRight]}>Amount (PKR)</Text>
          </View>

          {splits && splits.length > 0 ? (
            splits.map((s, idx) => (
              <View key={idx} style={styles.tableRow}>
                <Text style={[{ width: "6%" }, styles.cellIndex]}>{idx + 1}</Text>
                <Text style={[{ width: "44%", paddingRight: 4 }, styles.cellTextBold]}>
                  {invoiceNo
                    ? `${isMoneyIn ? "Receipt towards" : "Payment against"} ${invoiceNo}`
                    : `${isMoneyIn ? "Receipt on account" : "Payment on account"} - ${partyName}`}
                </Text>
                <Text style={[{ width: "15%" }, styles.cellCenter]}>{s.method}</Text>
                <Text style={[{ width: "17%", paddingRight: 4 }, styles.cellText]}>
                  {s.reference || "—"}
                </Text>
                <Text style={[{ width: "18%" }, styles.cellBoldRight]}>{formatMoney(s.amount)}</Text>
              </View>
            ))
          ) : (
            <View style={styles.tableRow}>
              <Text style={[{ width: "6%" }, styles.cellIndex]}>1</Text>
              <Text style={[{ width: "44%", paddingRight: 4 }, styles.cellTextBold]}>
                {invoiceNo
                  ? `${isMoneyIn ? "Receipt towards" : "Payment against"} ${invoiceNo}`
                  : `${isMoneyIn ? "Receipt on account" : "Payment on account"} - ${partyName}`}
              </Text>
              <Text style={[{ width: "15%" }, styles.cellCenter]}>{method}</Text>
              <Text style={[{ width: "17%", paddingRight: 4 }, styles.cellText]}>
                {displayReceiptNo}
              </Text>
              <Text style={[{ width: "18%" }, styles.cellBoldRight]}>{formatMoney(amount)}</Text>
            </View>
          )}
        </View>

        {/* Bottom Section */}
        <View style={styles.bottomSection}>
          <View style={styles.notesCol}>
            {notes ? (
              <View>
                <Text style={styles.notesHeading}>Payment Remarks / Notes</Text>
                <Text style={styles.notesBody}>{notes}</Text>
              </View>
            ) : (
              <View>
                <Text style={styles.notesHeading}>Remarks</Text>
                <Text style={styles.notesBody}>
                  Computer-generated payment voucher. This confirms receipt/disbursement of the stated amount against the customer or supplier account.
                </Text>
              </View>
            )}
          </View>

          <View style={styles.summaryCol}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Total Settled:</Text>
              <Text style={styles.summaryValue}>PKR {formatMoney(amount)}</Text>
            </View>
            {remainingBalance != null ? (
              <View
                style={[
                  styles.summaryRow,
                  { borderTopWidth: 0.5, borderTopColor: "#9ca3af", paddingTop: 3, marginTop: 3 },
                ]}
              >
                <Text style={[styles.summaryLabel, { fontFamily: "Helvetica-Bold", color: "#000000" }]}>
                  Remaining Balance:
                </Text>
                <Text style={[styles.summaryValue, { fontFamily: "Helvetica-Bold", color: "#000000" }]}>
                  PKR {formatMoney(Math.abs(remainingBalance))}{" "}
                  {remainingBalance > 0
                    ? isMoneyIn ? "(Dr - Owes you)" : "(Cr - You owe)"
                    : remainingBalance < 0
                      ? isMoneyIn ? "(Cr - Advance)" : "(Dr - Advance)"
                      : "(Settled)"}
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* Signatures */}
        <View style={styles.signaturesRow}>
          <View style={styles.sigBlock}>
            <View style={styles.sigLine}>
              <Text style={styles.sigTitle}>Authorized Cashier / Accounts</Text>
            </View>
          </View>
          <View style={styles.sigBlock}>
            <View style={styles.sigLine}>
              <Text style={styles.sigTitle}>Payee / Customer Signature</Text>
            </View>
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text>{companyName} — Official Voucher</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

