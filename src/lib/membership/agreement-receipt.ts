import "server-only";

import { createHash } from "node:crypto";

export const AGREEMENT_RECEIPT_GENERATOR_VERSION = "membership-agreement-text-v1";
export const DELEGATED_AGREEMENT_RECEIPT_GENERATOR_VERSION = "membership-agreement-text-v2";

export type AgreementReceiptDelegation = Readonly<{
  authorizationId: string;
  authorizedAt: string;
  memberName: string;
  memberEmail: string;
  authorityVersion: string;
  authorityText: string;
}>;

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
  delegation?: AgreementReceiptDelegation | null;
}>;

// Keep v1 byte-for-byte reproducible for receipts already issued.
function renderAgreementReceiptV1(source: AgreementReceiptSource): string {
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

function renderAgreementReceiptV2(source: AgreementReceiptSource): string {
  const delegation = source.delegation;
  if (!delegation || !delegation.authorizationId || !delegation.authorizedAt || !delegation.memberName
    || !delegation.memberEmail || !delegation.authorityVersion || !delegation.authorityText) {
    throw new Error("Delegated agreement receipt authority is incomplete.");
  }
  return [
    "RUINED MEMBERSHIP",
    "AGREEMENT ACCEPTANCE RECEIPT",
    "",
    `Agreement: ${source.agreementTitle}`,
    `Agreement key: ${source.agreementKey}`,
    `Agreement version: ${source.agreementVersion}`,
    `Accepted at: ${source.acceptedAt}`,
    `Accepted by: ${source.signerName}`,
    `Signer email: ${source.signerEmail}`,
    `On behalf of: ${delegation.memberName}`,
    `Member account email: ${delegation.memberEmail}`,
    `Acceptance method: ${source.affirmativeAction}`,
    `Acceptance ID: ${source.acceptanceId}`,
    `Agreement content SHA-256: ${source.agreementContentSha256}`,
    "",
    "--- AUTHORITY RECORDED AT ACCEPTANCE ---",
    "",
    `Authorization ID: ${delegation.authorizationId}`,
    `Authorized at: ${delegation.authorizedAt}`,
    `Authority version: ${delegation.authorityVersion}`,
    delegation.authorityText,
    "",
    "--- AGREEMENT AS ACCEPTED ---",
    "",
    source.agreementBody,
    "",
    "--- END AGREEMENT ---",
    "",
    "This receipt is generated from Ruined's immutable acceptance and operator authorization records.",
    "",
  ].join("\n");
}

export function agreementReceiptGeneratorVersion(source: AgreementReceiptSource): string {
  return source.delegation ? DELEGATED_AGREEMENT_RECEIPT_GENERATOR_VERSION : AGREEMENT_RECEIPT_GENERATOR_VERSION;
}

export function renderAgreementReceipt(source: AgreementReceiptSource): string {
  return renderAgreementReceiptForVersion(agreementReceiptGeneratorVersion(source), source);
}

export function renderAgreementReceiptForVersion(
  generatorVersion: string,
  source: AgreementReceiptSource,
): string {
  if (generatorVersion === AGREEMENT_RECEIPT_GENERATOR_VERSION) return renderAgreementReceiptV1(source);
  if (generatorVersion === DELEGATED_AGREEMENT_RECEIPT_GENERATOR_VERSION) return renderAgreementReceiptV2(source);
  throw new Error("This agreement receipt generator is not available.");
}

export function agreementReceiptSha256(receipt: string): string {
  return createHash("sha256").update(receipt, "utf8").digest("hex");
}
