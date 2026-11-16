// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import PrivacyPage from "@/app/privacy/page";
import { render } from "../helpers/dom";

describe("privacy page", () => {
  it("states the Google API Services User Data Policy and Limited Use requirements", () => {
    const { container } = render(<PrivacyPage />);
    expect(container.textContent).toContain(
      "EasyEdit's use and transfer of information received from Google APIs to any other app will adhere to the Google API Services User Data Policy, including the Limited Use requirements.",
    );
  });

  it("links the policy name to Google's policy page", () => {
    const { container } = render(<PrivacyPage />);
    const link = Array.from(container.querySelectorAll("a")).find((a) => a.textContent === "Google API Services User Data Policy");
    expect(link?.getAttribute("href")).toBe("https://developers.google.com/terms/api-services-user-data-policy");
    expect(link?.getAttribute("target")).toBeNull();
  });

  it("says how the Drive access EasyEdit keeps is stored and used", () => {
    const { container } = render(<PrivacyPage />);
    expect(container.textContent).toContain(
      "The access EasyEdit keeps for a connected Google Drive is stored encrypted, and is used only to store and play the videos you add to EasyEdit.",
    );
  });
});
