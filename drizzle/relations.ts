import { relations } from "drizzle-orm";
import {
  users,
  stocks,
  stockPrices,
  predictions,
  watchlist,
  newsSentiment,
  alerts
} from "./schema";

export const usersRelations = relations(users, ({ many }) => ({
  watchlist: many(watchlist),
  alerts: many(alerts),
}));

export const stocksRelations = relations(stocks, ({ many }) => ({
  prices: many(stockPrices),
  predictions: many(predictions),
  watchlist: many(watchlist),
  newsSentiment: many(newsSentiment),
  alerts: many(alerts),
}));

export const stockPricesRelations = relations(stockPrices, ({ one }) => ({
  stock: one(stocks, {
    fields: [stockPrices.stockId],
    references: [stocks.id],
  }),
}));

export const predictionsRelations = relations(predictions, ({ one }) => ({
  stock: one(stocks, {
    fields: [predictions.stockId],
    references: [stocks.id],
  }),
}));

export const watchlistRelations = relations(watchlist, ({ one }) => ({
  user: one(users, {
    fields: [watchlist.userId],
    references: [users.id],
  }),
  stock: one(stocks, {
    fields: [watchlist.stockId],
    references: [stocks.id],
  }),
}));

export const newsSentimentRelations = relations(newsSentiment, ({ one }) => ({
  stock: one(stocks, {
    fields: [newsSentiment.stockId],
    references: [stocks.id],
  }),
}));

export const alertsRelations = relations(alerts, ({ one }) => ({
  user: one(users, {
    fields: [alerts.userId],
    references: [users.id],
  }),
  stock: one(stocks, {
    fields: [alerts.stockId],
    references: [stocks.id],
  }),
}));
