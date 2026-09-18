import { describe, expect, it } from "vitest";
import { allocatePort, assertPortFree, assertValidPort } from "./ports.js";

describe("allocatePort (PLAN §11.4)", () => {
  it("returns the first free port in range", () => {
    expect(allocatePort({ start: 8080, end: 8099 }, [])).toBe(8080);
    expect(allocatePort({ start: 8080, end: 8099 }, [8080, 8081, 8082])).toBe(
      8083,
    );
  });

  it("skips taken ports anywhere in the range", () => {
    expect(allocatePort({ start: 8080, end: 8099 }, [8085])).toBe(8080);
    expect(allocatePort({ start: 8080, end: 8099 }, [8080])).toBe(8081);
  });

  it("throws PORT_IN_USE when the whole range is occupied", () => {
    const taken: number[] = [];
    for (let p = 8080; p <= 8099; p++) taken.push(p);
    expect(() => allocatePort({ start: 8080, end: 8099 }, taken)).toThrow(
      /no free port/,
    );
  });
});

describe("assertPortFree (pinned port collision)", () => {
  it("passes when the pinned port is free", () => {
    expect(() =>
      assertPortFree(8085, { start: 8080, end: 8099 }, [8080]),
    ).not.toThrow();
  });

  it("throws PORT_IN_USE with a free-port suggestion on collision", () => {
    try {
      assertPortFree(8080, { start: 8080, end: 8099 }, [8080]);
      expect.unreachable("should throw");
    } catch (err) {
      expect((err as Error).message).toMatch(/8080 is already in use/);
      expect((err as { code: string }).code).toBe("PORT_IN_USE");
    }
  });
});

describe("assertValidPort (S-9 bound)", () => {
  it("accepts a valid port and rejects out-of-range", () => {
    expect(() => assertValidPort(8080)).not.toThrow();
    expect(() => assertValidPort(1023)).toThrow();
    expect(() => assertValidPort(65536)).toThrow();
    expect(() => assertValidPort(8080.5)).toThrow();
  });
});
