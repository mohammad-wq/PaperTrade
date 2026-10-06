"use server";

import {
  listPurchaseInvoicesAction as _listPurchaseInvoicesAction,
  createPurchaseInvoiceAction as _createPurchaseInvoiceAction,
  updatePurchaseInvoiceAction as _updatePurchaseInvoiceAction,
  deletePurchaseInvoiceAction as _deletePurchaseInvoiceAction,
} from "./invoices";

import {
  partnershipPurchaseIntakeAction as _partnershipPurchaseIntakeAction,
  recordPartnershipIntakeAction as _recordPartnershipIntakeAction,
} from "./partnerships";

export async function listPurchaseInvoicesAction(...args: Parameters<typeof _listPurchaseInvoicesAction>) {
  return _listPurchaseInvoicesAction(...args);
}

export async function createPurchaseInvoiceAction(raw: unknown) {
  return _createPurchaseInvoiceAction(raw);
}

export async function updatePurchaseInvoiceAction(raw: unknown) {
  return _updatePurchaseInvoiceAction(raw);
}

export async function deletePurchaseInvoiceAction(raw: unknown) {
  return _deletePurchaseInvoiceAction(raw);
}

export async function partnershipPurchaseIntakeAction(raw: unknown) {
  return _partnershipPurchaseIntakeAction(raw);
}

export async function recordPartnershipIntakeAction(raw: unknown) {
  return _recordPartnershipIntakeAction(raw);
}

