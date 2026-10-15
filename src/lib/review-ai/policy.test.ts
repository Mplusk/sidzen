import { expect, it } from "vitest";
import { REVIEW_AI_CONSENT_VERSION, REVIEW_AI_CONSENT_VERSIONS, REVIEW_AI_CONSENT_TEXT } from "./policy";
import { REVIEW_CONSENT_VERSION, SIDZEN_REVIEW_CONSENT_VERSIONS } from "../reviews";

it("keeps publication scopes but does not expand historical AI permissions", () => {
  expect(REVIEW_AI_CONSENT_VERSIONS).toContain(REVIEW_AI_CONSENT_VERSION);
  expect(REVIEW_AI_CONSENT_VERSIONS).not.toContain("2026-10-09-review-ai-v1");
  expect(REVIEW_AI_CONSENT_VERSIONS).not.toContain("2026-10-11-review-ai-v2");
  expect(SIDZEN_REVIEW_CONSENT_VERSIONS).toContain(REVIEW_CONSENT_VERSION);
  expect(SIDZEN_REVIEW_CONSENT_VERSIONS).toContain("2026-10-11-reviews-sidzen-v3");
  expect(SIDZEN_REVIEW_CONSENT_VERSIONS).not.toContain("2026-10-06-reviews-v1");
  expect(REVIEW_AI_CONSENT_TEXT).toContain("по контактам оператора");
});
