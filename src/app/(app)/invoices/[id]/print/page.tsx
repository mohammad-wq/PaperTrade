import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import InvoicePrintClient from "./InvoicePrintClient";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function InvoicePrintPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const sParams = await searchParams;
  const initialFormat = (sParams.format === "A5" ? "A5" : "A4") as "A4" | "A5";
  const isDirect = sParams.direct === "true";

  // Try finding sale invoice first
  const saleInvoice = await prisma.saleInvoice.findUnique({
    where: { id },
    include: {
      customer: true,
      location: true,
      deliveryOrder: true,
      financialYear: true,
      createdBy: { select: { id: true, name: true, email: true } },
      items: {
        include: {
          product: true,
          location: true,
          warehouseLot: true,
          lot: true,
        },
      },
    },
  });

  if (saleInvoice) {
    const serialized = {
      type: "SALE" as const,
      id: saleInvoice.id,
      invoiceNo: saleInvoice.invoiceNo,
      sequenceNo: saleInvoice.sequenceNo,
      date: saleInvoice.date.toISOString(),
      status: saleInvoice.status,
      totalAmount: Number(saleInvoice.totalAmount),
      amountPaid: Number(saleInvoice.amountPaid || saleInvoice.paidAmount || 0),
      balanceDue: Number(saleInvoice.balanceAmount || Math.max(0, Number(saleInvoice.totalAmount) - Number(saleInvoice.amountPaid || saleInvoice.paidAmount || 0))),
      freightCharges: Number(saleInvoice.freightCharges || 0),
      walkInName: saleInvoice.walkInName,
      notes: saleInvoice.notes,
      financialYearLabel: saleInvoice.financialYear?.label,
      party: {
        id: saleInvoice.customer.id,
        name: saleInvoice.customer.name,
        type: saleInvoice.customer.type,
        phone: saleInvoice.customer.phone,
        address: saleInvoice.customer.address,
      },
      locationName: saleInvoice.location.name,
      createdByName: saleInvoice.createdBy.name,
      deliveryOrderNo: saleInvoice.deliveryOrder?.doNo,
      items: saleInvoice.items.map((it: any) => ({
        id: it.id,
        productNo: it.product.productNo,
        name: it.product.name,
        unit: it.product.unit,
        length: it.product.length ? Number(it.product.length) : null,
        breadth: it.product.breadth ? Number(it.product.breadth) : null,
        gsm: it.product.gsm ? Number(it.product.gsm) : null,
        packetWeight: it.product.packetWeight ? Number(it.product.packetWeight) : null,
        reamWeight: it.product.reamWeight ? Number(it.product.reamWeight) : null,
        quantity: Number(it.quantity),
        unitPrice: Number(it.unitPrice),
        lineTotal: Number(it.lineTotal),
        lotNumber: it.lot?.lotNumber || it.warehouseLot?.lotNumber,
      })),
    };

    return (
      <InvoicePrintClient
        invoice={serialized}
        initialFormat={initialFormat}
        direct={isDirect}
      />
    );
  }

  // Try finding purchase invoice
  const purchaseInvoice = await prisma.purchaseInvoice.findUnique({
    where: { id },
    include: {
      supplier: true,
      location: true,
      financialYear: true,
      createdBy: { select: { id: true, name: true, email: true } },
      items: {
        include: {
          product: true,
          location: true,
          warehouseLot: true,
        },
      },
    },
  });

  if (purchaseInvoice) {
    const serialized = {
      type: "PURCHASE" as const,
      id: purchaseInvoice.id,
      invoiceNo: purchaseInvoice.invoiceNo,
      sequenceNo: purchaseInvoice.sequenceNo,
      date: purchaseInvoice.date.toISOString(),
      status: purchaseInvoice.status,
      totalAmount: Number(purchaseInvoice.totalAmount),
      amountPaid: Number(purchaseInvoice.amountPaid || purchaseInvoice.paidAmount || 0),
      balanceDue: Number(purchaseInvoice.balanceAmount || Math.max(0, Number(purchaseInvoice.totalAmount) - Number(purchaseInvoice.amountPaid || purchaseInvoice.paidAmount || 0))),
      freightCharges: Number(purchaseInvoice.freightCharges || 0),
      walkInName: null,
      notes: purchaseInvoice.notes,
      financialYearLabel: purchaseInvoice.financialYear?.label,
      party: {
        id: purchaseInvoice.supplier.id,
        name: purchaseInvoice.supplier.name,
        type: purchaseInvoice.supplier.type,
        phone: purchaseInvoice.supplier.phone,
        address: purchaseInvoice.supplier.address,
      },
      locationName: purchaseInvoice.location.name,
      createdByName: purchaseInvoice.createdBy.name,
      deliveryOrderNo: undefined,
      items: purchaseInvoice.items.map((it: any) => ({
        id: it.id,
        productNo: it.product.productNo,
        name: it.product.name,
        unit: it.product.unit,
        length: it.product.length ? Number(it.product.length) : null,
        breadth: it.product.breadth ? Number(it.product.breadth) : null,
        gsm: it.product.gsm ? Number(it.product.gsm) : null,
        packetWeight: it.product.packetWeight ? Number(it.product.packetWeight) : null,
        reamWeight: it.product.reamWeight ? Number(it.product.reamWeight) : null,
        quantity: Number(it.quantity),
        unitPrice: Number(it.unitPrice),
        lineTotal: Number(it.lineTotal),
        lotNumber: it.warehouseLot?.lotNumber,
      })),
    };

    return (
      <InvoicePrintClient
        invoice={serialized}
        initialFormat={initialFormat}
        direct={isDirect}
      />
    );
  }

  notFound();
}
