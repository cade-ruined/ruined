/** Keep this revision aligned with the published /privacy document. */
export const REGISTRATION_PRIVACY_VERSION = "privacy-2026-10-08";
export const REGISTRATION_LEGAL_CONTEXT = "registration_documents_v1";
export const REGISTRATION_LEGAL_NOTICE = "I agree to the Membership Terms and acknowledge the Privacy Policy. Registration and saving a card do not start a paid membership or authorize a charge.";
export const REGISTRATION_LEGAL_UNAVAILABLE = "The membership terms are temporarily unavailable. Please try again before completing registration.";

export type RegistrationLegalAcknowledgment = {
  acknowledged: true;
  privacyVersion: string;
  agreementVersionId: string;
};

export type RegistrationLegalNotice = {
  state: "required";
  privacyVersion: string;
  privacyHref: string;
  agreementVersionId: string;
  agreementVersion: number;
  agreementTitle: string;
  agreementHref: string;
  noticeText: string;
} | { state: "unavailable"; message: string };
