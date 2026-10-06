import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import DeliveryOrderPrintClient from "./DeliveryOrderPrintClient";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function DeliveryOrderPrintPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const sParams = await searchParams;
  const initialFormat = (sParams.format === "A4" ? "A4" : "A5") as "A4" | "A5";
  const isDirect = sParams.direct === "true";

  const deliveryOrder = await prisma.deliveryOrder.findUnique({
    where: { id },
    include: {
      customer: true,
      location: true,
      destinationLocation: true,
      linkedSaleInvoice: true,
      financialYear: true,
      createdBy: { select: { id: true, name: true } },
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

  if (!deliveryOrder) {
    notFound();
  }

  const serialized = {
    id: deliveryOrder.id,
    doNo: deliveryOrder.doNo,
    sequenceNo: deliveryOrder.sequenceNo,
    date: deliveryOrder.date.toISOString(),
    status: deliveryOrder.status,
    vehicleNo: deliveryOrder.vehicleNo,
    driverName: deliveryOrder.driverName,
    deliveredTo: deliveryOrder.deliveredTo,
    recipientName: deliveryOrder.recipientName,
    notes: deliveryOrder.notes,
    financialYearLabel: deliveryOrder.financialYear?.label,
    customerName: deliveryOrder.customer?.name || deliveryOrder.deliveredTo || "Counter Customer",
    customerPhone: deliveryOrder.customer?.phone,
    customerAddress: deliveryOrder.customer?.address,
    sourceLocationName: deliveryOrder.location.name,
    destinationLocationName: deliveryOrder.destinationLocation?.name,
    saleInvoiceNo: deliveryOrder.linkedSaleInvoice?.invoiceNo,
    createdByName: deliveryOrder.createdBy.name,
    items: deliveryOrder.items.map((it: any) => ({
      id: it.id,
      productNo: it.product.productNo,
      name: it.product.name,
      unit: it.unit,
      length: it.product.length ? Number(it.product.length) : null,
      breadth: it.product.breadth ? Number(it.product.breadth) : null,
      gsm: it.product.gsm ? Number(it.product.gsm) : null,
      packetWeight: it.product.packetWeight ? Number(it.product.packetWeight) : null,
      reamWeight: it.product.reamWeight ? Number(it.product.reamWeight) : null,
      quantity: Number(it.quantity),
      lotNumber: it.lot?.lotNumber || it.warehouseLot?.lotNumber,
    })),
  };

  return (
    <DeliveryOrderPrintClient
      order={serialized}
      initialFormat={initialFormat}
      direct={isDirect}
    />
  );
}
