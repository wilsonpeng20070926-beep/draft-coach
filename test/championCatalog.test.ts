import { describe, expect, it } from "vitest";
import { createFixtureCatalog } from "./fixtures/championFixture";

describe("champion catalog", () => {
  it("resolves champions by numeric id and slug", () => {
    const catalog = createFixtureCatalog();

    expect(catalog.version()).toBe("15.10.1");
    expect(catalog.byId(157)?.name).toBe("Yasuo");
    expect(catalog.bySlug("Aatrox")?.id).toBe(266);
  });

  it("handles slug and display name differences", () => {
    const catalog = createFixtureCatalog();
    const wukong = catalog.byId(62);

    expect(wukong?.slug).toBe("MonkeyKing");
    expect(wukong?.name).toBe("Wukong");
    expect(catalog.bySlug("MonkeyKing")?.name).toBe("Wukong");
  });

  it("returns null for empty or unknown champion ids", () => {
    const catalog = createFixtureCatalog();

    expect(catalog.byId(0)).toBeNull();
    expect(catalog.byId(999999)).toBeNull();
  });
});
