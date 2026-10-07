import { describe, expect, it } from "vitest";
import { compareVersions, parseVersion, pickUpdate } from "./ota";

const MANIFEST = "https://giovannimazza.github.io/paldrop/ota.json";
const ZIP = "https://giovannimazza.github.io/paldrop/paldrop-1.261008.900.zip";

describe("parseVersion", () => {
  it("accepts dotted numbers", () => {
    expect(parseVersion("1.261007.2130")).toEqual([1, 261007, 2130]);
  });

  it("rejects anything that is not a plain version", () => {
    for (const value of ["builtin", "1.2.x", "", "v1.2.3", "1.2.3.4.5", 12, null]) {
      expect(parseVersion(value)).toBeNull();
    }
  });
});

describe("compareVersions", () => {
  it("orders by segment, padding the shorter side", () => {
    expect(compareVersions([1, 2, 3], [1, 2, 2])).toBeGreaterThan(0);
    expect(compareVersions([1, 261007, 2130], [1, 261007, 2130])).toBe(0);
    expect(compareVersions([1, 2], [1, 2, 0])).toBe(0);
    expect(compareVersions([1, 261007, 59], [1, 261008, 0])).toBeLessThan(0);
  });
});

describe("pickUpdate", () => {
  it("accepts a newer bundle on the manifest origin", () => {
    const picked = pickUpdate({ version: "1.261008.900", url: ZIP }, "1.261007.2130", MANIFEST);
    expect(picked).toEqual({ version: "1.261008.900", url: ZIP });
  });

  it("ignores a bundle that is not newer", () => {
    expect(pickUpdate({ version: "1.261007.2130", url: ZIP }, "1.261007.2130", MANIFEST)).toBeNull();
    expect(pickUpdate({ version: "1.261006.100", url: ZIP }, "1.261007.2130", MANIFEST)).toBeNull();
  });

  it("refuses a bundle hosted somewhere else", () => {
    const elsewhere = "https://evil.example/paldrop.zip";
    expect(pickUpdate({ version: "9.9.9", url: elsewhere }, "1.0.0", MANIFEST)).toBeNull();
  });

  it("refuses plain http", () => {
    const insecure = "http://giovannimazza.github.io/paldrop/x.zip";
    expect(pickUpdate({ version: "9.9.9", url: insecure }, "1.0.0", MANIFEST)).toBeNull();
  });

  it("refuses a malformed manifest", () => {
    for (const raw of [null, "nope", {}, { version: "9.9.9" }, { url: ZIP }, { version: "latest", url: ZIP }]) {
      expect(pickUpdate(raw, "1.0.0", MANIFEST)).toBeNull();
    }
  });
});
