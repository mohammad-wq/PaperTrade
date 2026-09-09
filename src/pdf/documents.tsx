import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page: {
    padding: 36,
    fontSize: 9,
    fontFamily: "Helvetica",
    color: "#1e293b",
    lineHeight: 1.4,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderBottomWidth: 1.5,
    borderBottomColor: "#0f766e",
    paddingBottom: 14,
    marginBottom: 16,
  },
  brandName: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#0f766e",
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
    fontSize: 15,
    fontWeight: "bold",
    color: "#0f172a",
    textTransform: "uppercase",
  },
  docNumber: {
    fontSize: 11,
    fontWeight: "bold",
    color: "#d97706",
    marginTop: 2,
  },
  metaGrid: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: "#f8fafc",
    padding: 10,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    marginBottom: 16,
  },
  metaCol: {
    width: "48%",
  },
  metaLabel: {
    fontSize: 8,
    fontWeight: "bold",
    color: "#64748b",
    textTransform: "uppercase",
    marginBottom: 2,
  },
  metaValue: {
    fontSize: 9,
    color: "#0f172a",
  },
  table: {
    marginTop: 8,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 4,
    overflow: "hidden",
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#f1f5f9",
    borderBottomWidth: 1,
    borderBottomColor: "#cbd5e1",
    paddingVertical: 6,
    paddingHorizontal: 8,
    fontWeight: "bold",
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  colProduct: { width: "40%" },
  colSpecs: { width: "20%" },
  colQty: { width: "12%", textAlign: "right" },
  colRate: { width: "13%", textAlign: "right" },
  colTotal: { width: "15%", textAlign: "right" },
  headerCell: {
    fontSize: 8,
    fontWeight: "bold",
    color: "#475569",
    textTransform: "uppercase",
  },
  cell: {
    fontSize: 8.5,
    color: "#1e293b",
  },
  summaryBox: {
    alignSelf: "flex-end",
    width: 220,
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    paddingTop: 8,
    marginBottom: 24,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
  },
  grandTotal: {
    fontSize: 11,
    fontWeight: "bold",
    color: "#0f766e",
    borderTopWidth: 1,
    borderTopColor: "#cbd5e1",
    paddingTop: 4,
    marginTop: 4,
  },
  notesBox: {
    backgroundColor: "#fffbeb",
    borderWidth: 1,
    borderColor: "#fef3c7",
    padding: 8,
    borderRadius: 4,
    marginBottom: 20,
  },
  notesTitle: {
    fontSize: 8,
    fontWeight: "bold",
    color: "#b45309",
    textTransform: "uppercase",
    marginBottom: 2,
  },
  notesContent: {
    fontSize: 8.5,
    color: "#78350f",
  },
  signaturesRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 20,
    paddingTop: 10,
  },
  sigBlock: {
    width: "42%",
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 4,
    padding: 10,
    minHeight: 80,
  },
  sigTitle: {
    fontSize: 8,
    fontWeight: "bold",
    color: "#475569",
    textTransform: "uppercase",
    marginBottom: 24,
  },
  sigLine: {
    borderTopWidth: 1,
    borderTopColor: "#94a3b8",
    paddingTop: 4,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  stampBox: {
    width: "12%",
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#94a3b8",
    borderRadius: 4,
    justifyContent: "center",
    alignItems: "center",
    minHeight: 80,
  },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 36,
    right: 36,
    borderTopWidth: 1,
    borderTopColor: "#f1f5f9",
    paddingTop: 8,
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

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.brandName}>{companyName}</Text>
            <Text style={styles.brandMeta}>{companyAddress}</Text>
            <Text style={styles.brandMeta}>Phone: {companyPhone}</Text>
          </View>
          <View style={styles.docTitleBox}>
            <Text style={styles.docTitle}>{docType}</Text>
            <Text style={styles.docNumber}>{docNumber}</Text>
            <Text style={styles.brandMeta}>Date: {date}</Text>
            {referenceNo ? <Text style={styles.brandMeta}>Ref: {referenceNo}</Text> : null}
          </View>
        </View>

        {/* Party and Location Information */}
        <View style={styles.metaGrid}>
          <View style={styles.metaCol}>
            <Text style={styles.metaLabel}>{partyLabel}</Text>
            <Text style={[styles.metaValue, { fontWeight: "bold" }]}>{partyName}</Text>
            {partyAddress ? <Text style={styles.metaValue}>{partyAddress}</Text> : null}
            {partyPhone ? <Text style={styles.metaValue}>Tel: {partyPhone}</Text> : null}
          </View>
          <View style={styles.metaCol}>
            {locationName ? (
              <View style={{ marginBottom: 4 }}>
                <Text style={styles.metaLabel}>Location</Text>
                <Text style={styles.metaValue}>{locationName}</Text>
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
          <View style={styles.tableHeader}>
            <Text style={[styles.colProduct, styles.headerCell]}>Item Description</Text>
            <Text style={[styles.colSpecs, styles.headerCell]}>Dimensions / GSM</Text>
            <Text style={[styles.colQty, styles.headerCell]}>Quantity</Text>
            {items.some((i) => i.unitPrice !== undefined) ? (
              <>
                <Text style={[styles.colRate, styles.headerCell]}>Rate</Text>
                <Text style={[styles.colTotal, styles.headerCell]}>Amount</Text>
              </>
            ) : (
              <Text style={[styles.colRate, styles.headerCell]}>Unit</Text>
            )}
          </View>
          {items.map((item, idx) => (
            <View key={idx} style={styles.tableRow}>
              <Text style={[styles.colProduct, styles.cell]}>{item.name}</Text>
              <Text style={[styles.colSpecs, styles.cell]}>{item.specs || "—"}</Text>
              <Text style={[styles.colQty, styles.cell]}>
                {item.quantity.toLocaleString()} {item.unit}
              </Text>
              {item.unitPrice !== undefined ? (
                <>
                  <Text style={[styles.colRate, styles.cell]}>{item.unitPrice.toFixed(2)}</Text>
                  <Text style={[styles.colTotal, styles.cell, { fontWeight: "bold" }]}>
                    {(item.lineTotal ?? item.quantity * item.unitPrice).toFixed(2)}
                  </Text>
                </>
              ) : (
                <Text style={[styles.colRate, styles.cell]}>{item.unit}</Text>
              )}
            </View>
          ))}
        </View>

        {/* Totals Summary */}
        {totalAmount !== undefined ? (
          <View style={styles.summaryBox}>
            <View style={styles.summaryRow}>
              <Text style={styles.metaLabel}>Subtotal</Text>
              <Text style={styles.metaValue}>{totalAmount.toFixed(2)}</Text>
            </View>
            {amountPaid !== undefined ? (
              <>
                <View style={styles.summaryRow}>
                  <Text style={styles.metaLabel}>Paid</Text>
                  <Text style={styles.metaValue}>{amountPaid.toFixed(2)}</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.grandTotal}>Balance Due</Text>
                  <Text style={styles.grandTotal}>{(totalAmount - amountPaid).toFixed(2)}</Text>
                </View>
              </>
            ) : (
              <View style={styles.summaryRow}>
                <Text style={styles.grandTotal}>Total</Text>
                <Text style={styles.grandTotal}>{totalAmount.toFixed(2)}</Text>
              </View>
            )}
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
                <Text style={{ fontSize: 7.5, color: "#64748b" }}>Signature & Date</Text>
              </View>
            </View>
            <View style={styles.stampBox}>
              <Text style={{ fontSize: 7.5, color: "#94a3b8", textAlign: "center" }}>SEAL / STAMP</Text>
            </View>
            <View style={styles.sigBlock}>
              <Text style={styles.sigTitle}>{signatures.rightLabel}</Text>
              <View style={styles.sigLine}>
                <Text style={{ fontSize: 7.5, color: "#64748b" }}>Signature & Date</Text>
              </View>
            </View>
          </View>
        ) : null}

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text>{companyName} — System Generated Document</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
