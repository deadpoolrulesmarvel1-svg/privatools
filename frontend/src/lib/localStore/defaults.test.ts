import { describe, it, expect, beforeEach } from "vitest";
import * as db from "./db";
import * as defaults from "./defaults";
import { loadPersisted, savePersisted } from "@/lib/persistence";

beforeEach(async () => {
  await db.destroy();
  localStorage.clear();
});

describe("localStore/defaults", () => {
  it("starts with no customized slugs", async () => {
    expect(await defaults.customizedSlugs()).toEqual([]);
  });

  it("registers a slug once", async () => {
    await defaults.registerCustomized("compress");
    await defaults.registerCustomized("compress");
    expect(await defaults.customizedSlugs()).toEqual(["compress"]);
  });

  it("unregisters a slug", async () => {
    await defaults.registerCustomized("compress");
    await defaults.registerCustomized("bates");
    await defaults.unregisterCustomized("compress");
    expect(await defaults.customizedSlugs()).toEqual(["bates"]);
  });

  it("clearSlug removes both the value and the registration", async () => {
    savePersisted("compress", { level: "extreme" });
    await defaults.registerCustomized("compress");
    await defaults.clearSlug("compress");
    expect(loadPersisted("compress")).toBeNull();
    expect(await defaults.customizedSlugs()).toEqual([]);
  });

  it("clearAll removes every registered slug's value", async () => {
    savePersisted("compress", { level: "extreme" });
    savePersisted("bates", { prefix: "X-" });
    await defaults.registerCustomized("compress");
    await defaults.registerCustomized("bates");
    await defaults.clearAll();
    expect(loadPersisted("compress")).toBeNull();
    expect(loadPersisted("bates")).toBeNull();
    expect(await defaults.customizedSlugs()).toEqual([]);
  });

  it("exports the customized values as a plain object", async () => {
    savePersisted("compress", { level: "extreme" });
    await defaults.registerCustomized("compress");
    expect(await defaults.exportDefaults()).toEqual({ compress: { level: "extreme" } });
  });

  it("skips a registered slug whose value has gone", async () => {
    await defaults.registerCustomized("ghost");
    expect(await defaults.exportDefaults()).toEqual({});
  });
});
