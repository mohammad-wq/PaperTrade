import type { ReactNode } from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page: {
    paddingTop: 48,
    paddingBottom: 56,
    paddingHorizontal: 48,
    fontSize: 10,
    fontFamily: "Helvetica",
  },
  header: { marginBottom: 16 },
  company: { fontSize: 16, fontWeight: 700 },
  meta: { marginTop: 4, color: "#444" },
  title: { fontSize: 14, marginBottom: 12 },
  footer: {
    position: "absolute",
    bottom: 32,
    left: 48,
    right: 48,
    fontSize: 8,
    color: "#666",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  signatureRow: { marginTop: 48, flexDirection: "row", justifyContent: "space-between", gap: 24 },
  signatureBlock: { width: "45%" },
  line: { marginTop: 36, borderBottomWidth: 1, borderBottomColor: "#333" },
  field: { marginTop: 8 },
});

export function PdfDocumentFrame({
  title,
  documentNo,
  children,
  signatures,
}: {
  title: string;
  documentNo: string;
  children: ReactNode;
  signatures?: { leftLabel: string; rightLabel: string };
}) {
  const company = process.env.BUSINESS_NAME ?? "Paper Trade Co.";
  const address = process.env.BUSINESS_ADDRESS ?? "";
  const phone = process.env.BUSINESS_PHONE ?? "";

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.company}>{company}</Text>
          <Text style={styles.meta}>{address}</Text>
          <Text style={styles.meta}>{phone}</Text>
        </View>
        <Text style={styles.title}>
          {title} {documentNo}
        </Text>
        {children}
        {signatures ? (
          <View style={styles.signatureRow}>
            <View style={styles.signatureBlock}>
              <Text>{signatures.leftLabel}</Text>
              <View style={styles.line} />
              <Text style={styles.field}>Name: ____________________</Text>
              <Text style={styles.field}>Date: ____________________</Text>
              <Text style={styles.field}>Stamp</Text>
            </View>
            <View style={styles.signatureBlock}>
              <Text>{signatures.rightLabel}</Text>
              <View style={styles.line} />
              <Text style={styles.field}>Name: ____________________</Text>
              <Text style={styles.field}>Date: ____________________</Text>
              <Text style={styles.field}>Stamp</Text>
            </View>
          </View>
        ) : null}
        <View style={styles.footer} fixed>
          <Text>{company}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
