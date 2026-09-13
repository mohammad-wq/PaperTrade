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
    paddingTop: 32,
    paddingBottom: 48,
    paddingHorizontal: 36,
    fontSize: 9,
    fontFamily: "Helvetica",
    color: "#1e293b",
    lineHeight: 1.4,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 2,
    borderBottomColor: "#065f46",
    paddingBottom: 12,
    marginBottom: 14,
  },
  brandName: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#065f46",
    letterSpacing: 0.5,
  },
  brandMeta: {
    fontSize: 8,
    color: "#64748b",
    marginTop: 2,
  },
  docTitleBox: {
    alignItems: "flex-end",
  },
  docTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#0f172a",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  docNumber: {
    fontSize: 11,
    fontWeight: "bold",
    color: "#0f766e",
    marginTop: 2,
  },
  docMeta: {
    fontSize: 8,
    color: "#64748b",
    marginTop: 1.5,
  },
  metaGrid: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: "#f8fafc",
    padding: 10,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    marginBottom: 14,
  },
  metaCol: {
    width: "48%",
  },
  metaLabel: {
    fontSize: 7.5,
    fontWeight: "bold",
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  metaPartyName: {
    fontSize: 10.5,
    fontWeight: "bold",
    color: "#0f172a",
    marginBottom: 2,
  },
  metaValue: {
    fontSize: 8.5,
    color: "#334155",
    lineHeight: 1.3,
  },
  table: {
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 4,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#f1f5f9",
    borderBottomWidth: 1,
    borderBottomColor: "#cbd5e1",
    paddingVertical: 6,
    paddingHorizontal: 8,
    alignItems: "center",
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 0.8,
    borderBottomColor: "#e2e8f0",
    paddingVertical: 5.5,
    paddingHorizontal: 8,
    backgroundColor: "#ffffff",
    alignItems: "center",
  },
  tableRowAlternate: {
    flexDirection: "row",
    borderBottomWidth: 0.8,
    borderBottomColor: "#e2e8f0",
    paddingVertical: 5.5,
    paddingHorizontal: 8,
    backgroundColor: "#f8fafc",
    alignItems: "center",
  },
  // Column Widths with rates (sum = 100%)
  colProduct: { width: "36%", paddingRight: 6 },
  colSpecs: { width: "22%", paddingRight: 6 },
  colQty: { width: "14%", textAlign: "right" },
  colRate: { width: "14%", textAlign: "right" },
  colTotal: { width: "14%", textAlign: "right" },
  // Column Widths without rates (sum = 100%)
  colProductFull: { width: "46%", paddingRight: 6 },
  colSpecsFull: { width: "30%", paddingRight: 6 },
  colQtyFull: { width: "24%", textAlign: "right" },
  headerCell: {
    fontSize: 8,
    fontWeight: "bold",
    color: "#334155",
    textTransform: "uppercase",
  },
  headerCellRight: {
    fontSize: 8,
    fontWeight: "bold",
    color: "#334155",
    textTransform: "uppercase",
    textAlign: "right",
  },
  cell: {
    fontSize: 8.5,
    color: "#1e293b",
  },
  cellRight: {
    fontSize: 8.5,
    color: "#1e293b",
    textAlign: "right",
  },
  cellBoldRight: {
    fontSize: 8.5,
    fontWeight: "bold",
    color: "#0f172a",
    textAlign: "right",
  },
  summaryContainer: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginBottom: 16,
  },
  summaryBox: {
    width: 230,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 4,
    padding: 8,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 2.5,
  },
  summaryLabel: {
    fontSize: 8,
    color: "#64748b",
    textTransform: "uppercase",
    fontWeight: "bold",
  },
  summaryValue: {
    fontSize: 9,
    color: "#0f172a",
    fontWeight: "bold",
  },
  grandTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 1.2,
    borderTopColor: "#065f46",
    paddingTop: 4,
    marginTop: 3,
  },
  grandTotalLabel: {
    fontSize: 9,
    fontWeight: "bold",
    color: "#065f46",
    textTransform: "uppercase",
  },
  grandTotalValue: {
    fontSize: 10.5,
    fontWeight: "bold",
    color: "#065f46",
  },
  notesBox: {
    backgroundColor: "#fffbeb",
    borderWidth: 1,
    borderColor: "#fde68a",
    padding: 8,
    borderRadius: 4,
    marginBottom: 16,
  },
  notesTitle: {
    fontSize: 7.5,
    fontWeight: "bold",
    color: "#92400e",
    textTransform: "uppercase",
    marginBottom: 2,
  },
  notesContent: {
    fontSize: 8,
    color: "#78350f",
    lineHeight: 1.35,
  },
  signaturesRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 14,
  },
  sigBlock: {
    width: "44%",
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 4,
    padding: 8,
    minHeight: 65,
    justifyContent: "space-between",
  },
  sigTitle: {
    fontSize: 7.5,
    fontWeight: "bold",
    color: "#475569",
    textTransform: "uppercase",
  },
  sigLine: {
    borderTopWidth: 1,
    borderTopColor: "#94a3b8",
    paddingTop: 3,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  stampBox: {
    width: "10%",
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#94a3b8",
    borderRadius: 4,
    justifyContent: "center",
    alignItems: "center",
    minHeight: 65,
  },
  footer: {
    position: "absolute",
    bottom: 20,
    left: 36,
    right: 36,
    borderTopWidth: 0.8,
    borderTopColor: "#e2e8f0",
    paddingTop: 6,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7.5,
    color: "#94a3b8",
  },
});

type ItemRow = {
  name: string;
  specs?: string;
  quantity: number;
  unit: string;
  unitPrice?: number;
  lineTotal?: number;
};

export function DocumentPdfView({
  docType,
  docNumber,
  date,
  partyLabel,
  partyName,
  partyAddress,
  partyPhone,
  locationName,
  referenceNo,
  items,
  totalAmount,
  amountPaid,
  notes,
  deliveryDetails,
  signatures,
}: {
  docType: string;
  docNumber: string;
  date: string;
  partyLabel: string;
  partyName: string;
  partyAddress?: string | null;
  partyPhone?: string | null;
  locationName?: string;
  referenceNo?: string | null;
  items: ItemRow[];
  totalAmount?: number;
  amountPaid?: number;
  notes?: string | null;
  deliveryDetails?: { vehicleNo?: string | null; driverName?: string | null; deliveredTo?: string | null };
  signatures?: { leftLabel: string; rightLabel: string };
}) {
  const companyName = process.env.BUSINESS_NAME || "PAPER TRADE CO.";
  const companyAddress = process.env.BUSINESS_ADDRESS || "Wholesale Paper Market, Station Road";
  const companyPhone = process.env.BUSINESS_PHONE || "+92-300-1234567";

  const hasRates = items.some((i) => typeof i.unitPrice === "number" && !isNaN(i.unitPrice));

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Brand Header */}
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.brandName}>{companyName}</Text>
            <Text style={styles.brandMeta}>{companyAddress}</Text>
            <Text style={styles.brandMeta}>Phone: {companyPhone}</Text>
          </View>
          <View style={styles.docTitleBox}>
            <Text style={styles.docTitle}>{docType}</Text>
            <Text style={styles.docNumber}>{docNumber}</Text>
            <Text style={styles.docMeta}>Date: {date}</Text>
            {referenceNo ? <Text style={styles.docMeta}>Ref: {referenceNo}</Text> : null}
          </View>
        </View>

        {/* Party and Location Information */}
        <View style={styles.metaGrid}>
          <View style={styles.metaCol}>
            <Text style={styles.metaLabel}>{partyLabel}</Text>
            <Text style={styles.metaPartyName}>{partyName}</Text>
            {partyAddress ? <Text style={styles.metaValue}>{partyAddress}</Text> : null}
            {partyPhone ? <Text style={styles.metaValue}>Tel: {partyPhone}</Text> : null}
          </View>
          <View style={styles.metaCol}>
            {locationName ? (
              <View style={{ marginBottom: 4 }}>
                <Text style={styles.metaLabel}>Location</Text>
                <Text style={[styles.metaValue, { fontWeight: "bold" }]}>{locationName}</Text>
              </View>
            ) : null}
            {deliveryDetails ? (
              <View>
                {deliveryDetails.vehicleNo ? <Text style={styles.metaValue}>Vehicle: {deliveryDetails.vehicleNo}</Text> : null}
                {deliveryDetails.driverName ? <Text style={styles.metaValue}>Driver: {deliveryDetails.driverName}</Text> : null}
                {deliveryDetails.deliveredTo ? <Text style={styles.metaValue}>Destination: {deliveryDetails.deliveredTo}</Text> : null}
              </View>
            ) : null}
          </View>
        </View>

        {/* Line Items Table */}
        <View style={styles.table}>
          {hasRates ? (
            <View style={styles.tableHeader}>
              <Text style={[styles.colProduct, styles.headerCell]}>Item Description</Text>
              <Text style={[styles.colSpecs, styles.headerCell]}>Dimensions / GSM</Text>
              <Text style={[styles.colQty, styles.headerCellRight]}>Quantity</Text>
              <Text style={[styles.colRate, styles.headerCellRight]}>Rate (PKR)</Text>
              <Text style={[styles.colTotal, styles.headerCellRight]}>Amount (PKR)</Text>
            </View>
          ) : (
            <View style={styles.tableHeader}>
              <Text style={[styles.colProductFull, styles.headerCell]}>Item Description</Text>
              <Text style={[styles.colSpecsFull, styles.headerCell]}>Dimensions / GSM</Text>
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
                  <Text style={[styles.colProduct, styles.cell]}>{item.name || "—"}</Text>
                  <Text style={[styles.colSpecs, styles.cell]}>{item.specs || "—"}</Text>
                  <Text style={[styles.colQty, styles.cellRight]}>
                    {Number(item.quantity || 0).toLocaleString()} {item.unit || ""}
                  </Text>
                  <Text style={[styles.colRate, styles.cellRight]}>{formatMoney(rateVal)}</Text>
                  <Text style={[styles.colTotal, styles.cellBoldRight]}>{formatMoney(lineVal)}</Text>
                </View>
              );
            }

            return (
              <View key={idx} style={isAlt ? styles.tableRowAlternate : styles.tableRow}>
                <Text style={[styles.colProductFull, styles.cell]}>{item.name || "—"}</Text>
                <Text style={[styles.colSpecsFull, styles.cell]}>{item.specs || "—"}</Text>
                <Text style={[styles.colQtyFull, styles.cellBoldRight]}>
                  {Number(item.quantity || 0).toLocaleString()} {item.unit || ""}
                </Text>
              </View>
            );
          })}
        </View>

        {/* Totals Summary */}
        {typeof totalAmount === "number" && !isNaN(totalAmount) ? (
          <View style={styles.summaryContainer}>
            <View style={styles.summaryBox}>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Subtotal</Text>
                <Text style={styles.summaryValue}>PKR {formatMoney(totalAmount)}</Text>
              </View>
              {typeof amountPaid === "number" && !isNaN(amountPaid) ? (
                <>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Amount Paid</Text>
                    <Text style={[styles.summaryValue, { color: "#065f46" }]}>PKR {formatMoney(amountPaid)}</Text>
                  </View>
                  <View style={styles.grandTotalRow}>
                    <Text style={styles.grandTotalLabel}>Balance Due</Text>
                    <Text style={styles.grandTotalValue}>PKR {formatMoney(totalAmount - amountPaid)}</Text>
                  </View>
                </>
              ) : (
                <View style={styles.grandTotalRow}>
                  <Text style={styles.grandTotalLabel}>Total Amount</Text>
                  <Text style={styles.grandTotalValue}>PKR {formatMoney(totalAmount)}</Text>
                </View>
              )}
            </View>
          </View>
        ) : null}

        {/* Notes */}
        {notes ? (
          <View style={styles.notesBox}>
            <Text style={styles.notesTitle}>Notes / Terms</Text>
            <Text style={styles.notesContent}>{notes}</Text>
          </View>
        ) : null}

        {/* Signatures and Stamp */}
        {signatures ? (
          <View style={styles.signaturesRow}>
            <View style={styles.sigBlock}>
              <Text style={styles.sigTitle}>{signatures.leftLabel}</Text>
              <View style={styles.sigLine}>
                <Text style={{ fontSize: 7, color: "#64748b" }}>Signature</Text>
                <Text style={{ fontSize: 7, color: "#64748b" }}>Date</Text>
              </View>
            </View>
            <View style={styles.stampBox}>
              <Text style={{ fontSize: 6.5, color: "#94a3b8", textAlign: "center" }}>STAMP</Text>
            </View>
            <View style={styles.sigBlock}>
              <Text style={styles.sigTitle}>{signatures.rightLabel}</Text>
              <View style={styles.sigLine}>
                <Text style={{ fontSize: 7, color: "#64748b" }}>Signature</Text>
                <Text style={{ fontSize: 7, color: "#64748b" }}>Date</Text>
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
