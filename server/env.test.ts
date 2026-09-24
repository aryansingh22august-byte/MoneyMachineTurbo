import { describe, it, expect, afterEach, vi } from "vitest";

const VALID_PG = "postgres://user:pass@localhost:5432/money_machine";
const SECRET32 = "0123456789abcdef0123456789abcdef";

/**
 * ENV is captured at module load, so each case re-imports the module with a
 * fresh registry after setting process.env.
 */
async function loadAssert(env: Record<string, string | undefined>) {
  vi.resetModules();
  const saved = { ...process.env };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    const mod = await import("./_core/env");
    return { assertProductionEnv: mod.assertProductionEnv, restore: () => (process.env = saved) };
  } catch (e) {
    process.env = saved;
    throw e;
  }
}

const base = {
  NODE_ENV: "production",
  DATABASE_URL: VALID_PG,
  JWT_SECRET: SECRET32,
  COOKIE_SECRET: undefined,
};

afterEach(() => vi.resetModules());

describe("assertProductionEnv", () => {
  it("passes on a well-formed production config", async () => {
    const { assertProductionEnv, restore } = await loadAssert(base);
    expect(() => assertProductionEnv()).not.toThrow();
    restore();
  });

  it("rejects an empty signing secret", async () => {
    const { assertProductionEnv, restore } = await loadAssert({
      ...base, JWT_SECRET: undefined,
    });
    expect(() => assertProductionEnv()).toThrow(/JWT_SECRET/);
    restore();
  });

  it("rejects a sqlite file: DATABASE_URL against the postgres client", async () => {
    const { assertProductionEnv, restore } = await loadAssert({
      ...base, DATABASE_URL: "file:/data/prod.db",
    });
    expect(() => assertProductionEnv()).toThrow(/postgres:\/\//);
    restore();
  });

  it("rejects a mysql:// DATABASE_URL", async () => {
    const { assertProductionEnv, restore } = await loadAssert({
      ...base, DATABASE_URL: "mysql://u:p@db:3306/x",
    });
    expect(() => assertProductionEnv()).toThrow(/postgres:\/\//);
    restore();
  });

  it("accepts postgresql:// as well as postgres://", async () => {
    const { assertProductionEnv, restore } = await loadAssert({
      ...base, DATABASE_URL: "postgresql://u:p@db:5432/x",
    });
    expect(() => assertProductionEnv()).not.toThrow();
    restore();
  });

  it("warns but does not throw on a short secret", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { assertProductionEnv, restore } = await loadAssert({
      ...base, JWT_SECRET: "tooshort",
    });
    expect(() => assertProductionEnv()).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("at least 32"));
    warn.mockRestore();
    restore();
  });

  it("accepts COOKIE_SECRET as an alias, matching the documented name", async () => {
    const { assertProductionEnv, restore } = await loadAssert({
      ...base, JWT_SECRET: undefined, COOKIE_SECRET: SECRET32,
    });
    expect(() => assertProductionEnv()).not.toThrow();
    restore();
  });

  it("does not throw outside production", async () => {
    const { assertProductionEnv, restore } = await loadAssert({
      NODE_ENV: "development",
      DATABASE_URL: "file:./dev.db",
      JWT_SECRET: undefined,
      COOKIE_SECRET: undefined,
    });
    expect(() => assertProductionEnv()).not.toThrow();
    restore();
  });
});
