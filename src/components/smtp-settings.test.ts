import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions/smtp-settings", () => ({ saveSmtpSettings: vi.fn() }));
vi.mock("@/lib/smtp/config", () => ({ getSmtpSettingsView: async () => ({ revision: "revision-qa", passwordConfigured: true, checkedAt: null, password: "never-render-this-secret" }) }));

import { SmtpSettings } from "./smtp-settings";

describe("SMTP settings form", () => {
  it("never renders the saved secret and presents a blank password field", async () => {
    const html = renderToStaticMarkup(await SmtpSettings({ message: "Подключение не удалось", error: true }));
    expect(html).not.toContain("never-render-this-secret");
    const passwordInput = html.match(/<input(?=[^>]*name="password")(?=[^>]*type="password")[^>]*>/)?.[0];
    expect(passwordInput).toBeDefined();
    expect(passwordInput).not.toMatch(/\svalue=/);
    expect(html).toContain('name="revision" value="revision-qa"');
    expect(html).toMatch(/<button(?=[^>]*name="verify")(?=[^>]*value="yes")[^>]*>/);
    expect(html).toContain('role="alert"');
    expect(html).toContain("само по себе не включает автоматическую отправку");
  });
});

