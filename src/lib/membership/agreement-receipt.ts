import "server-only";

import { createHash } from "node:crypto";

export const AGREEMENT_RECEIPT_GENERATOR_VERSION = "membership-agreement-text-v1";

export type AgreementReceiptSource = Readonly<{
  acceptanceId: string;
  acceptedAt: string;
  affirmativeAction: string;
  agreementBody: string;
  agreementContentSha256: string;
  agreementKey: string;
  agreementTitle: string;
  agreementVersion: number;
  signerEmail: string;
  signerName: string;
}>;

export function renderAgreementReceipt(source: AgreementReceiptSource): string {
  return [
    "RUINED MEMBERSHIP",
    "AGREEMENT ACCEPTANCE RECEIPT",
    "",
    `Agreement: ${source.agreementTitle}`,
    `Agreement key: ${source.agreementKey}`,
    `Agreement version: ${source.agreementVersion}`,
    `Accepted at: ${source.acceptedAt}`,
    `Accepted by: ${source.signerName}`,
    `Account email: ${source.signerEmail}`,
    `Acceptance method: ${source.affirmativeAction}`,
    `Acceptance ID: ${source.acceptanceId}`,
    `Agreement content SHA-256: ${source.agreementContentSha256}`,
    "",
    "--- AGREEMENT AS ACCEPTED ---",
    "",
    source.agreementBody,
    "",
    "--- END AGREEMENT ---",
    "",
    "This receipt is generated from Ruined's immutable acceptance record.",
    "",
  ].join("\n");
}

export function renderAgreementReceiptForVersion(
  generatorVersion: string,
  source: AgreementReceiptSource,
): string {
  if (generatorVersion !== AGREEMENT_RECEIPT_GENERATOR_VERSION) {
    throw new Error("This agreement receipt generator is not available.");
  }
  return renderAgreementReceipt(source);
}

export function agreementReceiptSha256(receipt: string): string {
  return createHash("sha256").update(receipt, "utf8").digest("hex");
}
