import { AccountType, PaymentMethod } from "@prisma/client";

export type PaymentDestinationInfo = {
  accountType: AccountType;
  accountName: string;
  destinationLabel: string;
};

/**
 * Maps payment methods to their specific accounting destination sub-accounts.
 * Liquid assets are tracked under AccountType.CASH with specific destination metadata
 * ensuring precise tracking for Cash, Bank, JazzCash, Easypaisa, and Cheque.
 */
export function getPaymentDestination(method: PaymentMethod | string): PaymentDestinationInfo {
  switch (method) {
    case PaymentMethod.CASH:
      return {
        accountType: AccountType.CASH,
        accountName: "Cash on Hand",
        destinationLabel: "Cash Drawer",
      };
    case PaymentMethod.BANK:
      return {
        accountType: AccountType.CASH,
        accountName: "Bank Account",
        destinationLabel: "Bank Transfer",
      };
    case PaymentMethod.JAZZCASH:
      return {
        accountType: AccountType.CASH,
        accountName: "JazzCash Wallet",
        destinationLabel: "JazzCash Mobile Wallet",
      };
    case PaymentMethod.EASYPAISA:
      return {
        accountType: AccountType.CASH,
        accountName: "Easypaisa Wallet",
        destinationLabel: "Easypaisa Mobile Wallet",
      };
    case PaymentMethod.CHEQUE:
      return {
        accountType: AccountType.CASH,
        accountName: "Cheque Clearing",
        destinationLabel: "Bank Cheque",
      };
    default:
      return {
        accountType: AccountType.CASH,
        accountName: "Other Payment Account",
        destinationLabel: "Other Mode",
      };
  }
}
