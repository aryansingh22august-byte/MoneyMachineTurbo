import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    // In development with AUTH_MODE=MOCK, allow a local admin user so you can run without OAuth
    // In production, failing auth means user is null (unauthenticated) — NOT admin
    if (process.env.NODE_ENV !== "production" && process.env.AUTH_MODE === "MOCK") {
      user = {
        id: 1,
        openId: "local-dev-admin",
        name: "Admin User",
        email: "admin@example.com",
        loginMethod: "local",
        role: "admin",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastSignedIn: new Date().toISOString(),
      };
    }
    // Otherwise user stays null — protectedProcedures will correctly reject the request
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
