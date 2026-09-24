CREATE TABLE IF NOT EXISTS "accuracyTracking" (
	"id" serial PRIMARY KEY NOT NULL,
	"stockId" integer NOT NULL,
	"predictionId" integer NOT NULL,
	"actualSignal" text,
	"isCorrect" integer,
	"priceAtPrediction" real,
	"priceAtResolution" real,
	"returnPercentage" real,
	"resolutionDate" text,
	"createdAt" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"stockId" integer NOT NULL,
	"alertType" text NOT NULL,
	"condition" text,
	"value" real,
	"message" text,
	"isActive" integer DEFAULT 1 NOT NULL,
	"triggeredAt" text,
	"createdAt" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "newsSentiment" (
	"id" serial PRIMARY KEY NOT NULL,
	"stockId" integer NOT NULL,
	"headline" text NOT NULL,
	"source" text,
	"sentimentScore" integer NOT NULL,
	"sentimentLabel" text NOT NULL,
	"url" text,
	"publishedAt" text,
	"createdAt" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "predictions" (
	"id" serial PRIMARY KEY NOT NULL,
	"stockId" integer NOT NULL,
	"signal" text NOT NULL,
	"strength" integer NOT NULL,
	"technicalScore" integer,
	"sentimentScore" integer,
	"rsi" real,
	"macd" real,
	"sma20" real,
	"sma50" real,
	"predictedPrice" real,
	"timestamp" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stockPrices" (
	"id" serial PRIMARY KEY NOT NULL,
	"stockId" integer NOT NULL,
	"lastPrice" real NOT NULL,
	"change" real,
	"percentChange" real,
	"open" real,
	"high" real,
	"low" real,
	"previousClose" real,
	"volume" integer,
	"timestamp" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stocks" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"companyName" text NOT NULL,
	"exchange" text NOT NULL,
	"sector" text,
	"industry" text,
	"marketCap" real,
	"peRatio" real,
	"dividendYield" real,
	"bookValue" real,
	"eps" real,
	"lastUpdated" text,
	"createdAt" text,
	CONSTRAINT "stocks_symbol_unique" UNIQUE("symbol")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"openId" text NOT NULL,
	"name" text,
	"email" text,
	"loginMethod" text,
	"role" text DEFAULT 'user' NOT NULL,
	"createdAt" text NOT NULL,
	"updatedAt" text NOT NULL,
	"lastSignedIn" text NOT NULL,
	CONSTRAINT "users_openId_unique" UNIQUE("openId")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "watchlist" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"stockId" integer NOT NULL,
	"addedAt" text
);
