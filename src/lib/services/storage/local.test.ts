import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LocalStorageProvider } from "./local";

const storage = () => new LocalStorageProvider(mkdtempSync(join(tmpdir(), "uploads-")));

describe("LocalStorageProvider", () => {
  it("stores, reads and deletes a file", async () => {
    const s = storage();
    await s.put("licences/user-1/front.jpg", Buffer.from("img"), "image/jpeg");
    expect(await s.exists("licences/user-1/front.jpg")).toBe(true);
    expect(await s.get("licences/user-1/front.jpg")).toEqual({ data: Buffer.from("img"), contentType: "image/jpeg" });
    await s.delete("licences/user-1/front.jpg");
    expect(await s.get("licences/user-1/front.jpg")).toBeNull();
  });

  it("rejects keys that escape the uploads folder", async () => {
    const s = storage();
    await expect(s.put("../escape.txt", Buffer.from("x"), "text/plain")).rejects.toThrow(/Invalid storage key/);
  });

  it("refuses a folder inside public/", () => {
    expect(() => new LocalStorageProvider("./public/uploads")).toThrow(/public/);
  });
});
