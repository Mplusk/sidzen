import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("keeps the header focused on catalog, search and shopping actions", () => {
  const header = readFileSync(new URL("./header.tsx", import.meta.url), "utf8");
  for (const removed of ["/delivery/", "/contacts/", "mailto:", "getStoreContacts"]) expect(header).not.toContain(removed);
  for (const retained of ["CatalogSearchInput", "HeaderShoppingActions"]) expect(header).toContain(retained);
  const actions = readFileSync(new URL("./header-shopping-actions.tsx", import.meta.url), "utf8");
  for (const retained of ["/account/", "/favorites/", "/cart/"]) expect(actions).toContain(retained);
  const search = readFileSync(new URL("./catalog-search-input.tsx", import.meta.url), "utf8");
  expect(search).toMatch(/className="[^"]*\bheader-search\b[^"]*"/); expect(search).toContain('action="/"');
});

it("removes documents and personal data from both desktop and mobile account navigation", () => {
  const layout = readFileSync(new URL("../app/account/layout.tsx", import.meta.url), "utf8");
  for (const removed of ["/account/documents/", "/account/privacy/"]) expect(layout).not.toContain(removed);
  for (const retained of ["/account/orders/", "/account/reviews/", "/account/profile/", "logoutAction"]) expect(layout).toContain(retained);
});

it("retires the self-service portal without removing profile, reviews or store contacts", () => {
  const profile = readFileSync(new URL("../app/account/profile/page.tsx", import.meta.url), "utf8");
  expect(profile).not.toContain("/account/privacy/");
  expect(profile).toContain("updateProfileAction");
  expect(profile).toContain("setSocialPassword");
  const portal = readFileSync(new URL("../app/account/privacy/page.tsx", import.meta.url), "utf8");
  expect(portal).toContain('redirect("/contacts/")');
  expect(portal).not.toContain("prisma");
  expect(portal).not.toContain("<form");
  const actions = readFileSync(new URL("../app/actions/privacy.ts", import.meta.url), "utf8");
  expect(actions).not.toContain("requestPersonalData");
  expect(actions).not.toContain("privacyRequest.create");
  const footer = readFileSync(new URL("./footer.tsx", import.meta.url), "utf8");
  for (const retained of ["/delivery/", "/contacts/"]) expect(footer).toContain(retained);
});

it("removes social sign-in controls from authorization and account settings without removing password setup", () => {
  const login = readFileSync(new URL("../app/login/page.tsx", import.meta.url), "utf8");
  const profile = readFileSync(new URL("../app/account/profile/page.tsx", import.meta.url), "utf8");
  const integrations = readFileSync(new URL("../app/account/integrations/page.tsx", import.meta.url), "utf8");
  expect(login).not.toContain("SocialLogin");
  expect(login).toContain("loginAction");
  expect(login).toContain("/register/");
  expect(login).toContain("/forgot-password/");
  for (const removed of ["SocialLogin", "disconnectSocialAccount", "Способы входа", "socialAccount.findMany"]) expect(profile).not.toContain(removed);
  expect(profile).toContain('user.passwordHash === "!social-only"');
  expect(profile).toContain("Пароль для входа");
  expect(integrations).not.toContain("SocialSettings");
  for (const retained of ["OzonDeliverySettings", "CategoryAiSettings", "CommunicationsSettings"]) expect(integrations).toContain(retained);
});

it("no longer advertises the retired portal in current legal and consent documents", () => {
  for (const path of ["../app/legal/privacy/page.tsx", "../app/legal/consent/page.tsx", "../app/legal/social-login/page.tsx", "../lib/privacy-documents.ts", "../lib/reviews.ts", "../lib/social/flow.ts", "../lib/review-ai/policy.ts"]) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    expect(source).not.toContain("/account/privacy/");
    expect(source).not.toContain("раздел «Персональные данные»");
  }
});
