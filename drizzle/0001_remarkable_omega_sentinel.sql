CREATE TABLE "paperTrades" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"stockId" integer NOT NULL,
	"symbol" text NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"mode" text NOT NULL,
	"entryPrice" real NOT NULL,
	"quantity" integer NOT NULL,
	"stopLoss" real NOT NULL,
	"targetPrice" real NOT NULL,
	"exitPrice" real,
	"realPnl" real,
	"openedAt" text NOT NULL,
	"closedAt" text,
	"reasoning" text
);
--> statement-breakpoint
CREATE TABLE "paperWallets" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"balance" real DEFAULT 1000 NOT NULL,
	"totalGained" real DEFAULT 0 NOT NULL,
	"totalLost" real DEFAULT 0 NOT NULL,
	"createdAt" text,
	"updatedAt" text
);
