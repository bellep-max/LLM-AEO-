import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const backendLogs = pgTable("backend_logs", {
  id: serial("id").primaryKey(),
  event: text("event").notNull(),
  model: text("model").notNull(),
  conversationId: integer("conversation_id"),
  tokensUsed: integer("tokens_used"),
  responseTimeMs: integer("response_time_ms"),
  status: text("status").notNull().default("success"),
  details: text("details"),
  timestamp: timestamp("timestamp", { withTimezone: true }).defaultNow().notNull(),
});

export const insertBackendLogSchema = createInsertSchema(backendLogs).omit({
  id: true,
  timestamp: true,
});

export type BackendLog = typeof backendLogs.$inferSelect;
export type InsertBackendLog = z.infer<typeof insertBackendLogSchema>;
