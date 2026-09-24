CREATE TABLE "botState" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"isActive" integer DEFAULT 0 NOT NULL,
	"globalScreenerMode" integer DEFAULT 0 NOT NULL,
	"allocPerTrade" real DEFAULT 10000 NOT NULL,
	"stopLossPct" real DEFAULT 2 NOT NULL,
	"targetPct" real DEFAULT 4 NOT NULL,
	"scalpMode" integer DEFAULT 0 NOT NULL,
	"updatedAt" text NOT NULL,
	CONSTRAINT "botState_userId_unique" UNIQUE("userId")
);
