import { Router } from "express";
import { db } from "@workspace/db";
import { conversations, messages } from "@workspace/db";
import { sql, desc, gte } from "drizzle-orm";
import { subDays, format } from "date-fns";

const router = Router();

router.get("/dashboard/stats", async (_req, res) => {
  const [totals] = await db
    .select({
      totalConversations: sql<number>`cast(count(distinct ${conversations.id}) as int)`,
      totalMessages: sql<number>`cast(count(${messages.id}) as int)`,
      avgResponseTimeMs: sql<number | null>`avg(${messages.responseTimeMs})`,
      totalTokensUsed: sql<number>`cast(coalesce(sum(${messages.tokensUsed}), 0) as int)`,
    })
    .from(conversations)
    .leftJoin(messages, sql`${messages.conversationId} = ${conversations.id}`);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [todayStats] = await db
    .select({
      conversationsToday: sql<number>`cast(count(distinct ${conversations.id}) as int)`,
    })
    .from(conversations)
    .where(gte(conversations.createdAt, today));

  const sevenDaysAgo = subDays(new Date(), 7);
  const [weekStats] = await db
    .select({
      messagesLast7Days: sql<number>`cast(count(${messages.id}) as int)`,
    })
    .from(messages)
    .where(gte(messages.createdAt, sevenDaysAgo));

  res.json({
    totalConversations: totals?.totalConversations ?? 0,
    totalMessages: totals?.totalMessages ?? 0,
    avgResponseTimeMs: totals?.avgResponseTimeMs
      ? Number(totals.avgResponseTimeMs)
      : null,
    totalTokensUsed: totals?.totalTokensUsed ?? 0,
    conversationsToday: todayStats?.conversationsToday ?? 0,
    messagesLast7Days: weekStats?.messagesLast7Days ?? 0,
  });
});

router.get("/dashboard/activity", async (_req, res) => {
  const activity = await db
    .select({
      id: messages.id,
      conversationId: messages.conversationId,
      conversationTitle: conversations.title,
      lastMessage: messages.content,
      role: messages.role,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .innerJoin(conversations, sql`${conversations.id} = ${messages.conversationId}`)
    .orderBy(desc(messages.createdAt))
    .limit(20);

  res.json(
    activity.map((a) => ({
      ...a,
      lastMessage: a.lastMessage.length > 100 ? a.lastMessage.slice(0, 100) + "..." : a.lastMessage,
      createdAt: a.createdAt.toISOString(),
    }))
  );
});

router.get("/dashboard/daily-volume", async (_req, res) => {
  const days: { date: string; messageCount: number; conversationCount: number }[] = [];

  for (let i = 13; i >= 0; i--) {
    const dayStart = subDays(new Date(), i);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = subDays(new Date(), i - 1);
    dayEnd.setHours(0, 0, 0, 0);

    const [msgCount] = await db
      .select({
        count: sql<number>`cast(count(*) as int)`,
      })
      .from(messages)
      .where(
        sql`${messages.createdAt} >= ${dayStart} AND ${messages.createdAt} < ${dayEnd}`
      );

    const [convCount] = await db
      .select({
        count: sql<number>`cast(count(*) as int)`,
      })
      .from(conversations)
      .where(
        sql`${conversations.createdAt} >= ${dayStart} AND ${conversations.createdAt} < ${dayEnd}`
      );

    days.push({
      date: format(dayStart, "MMM d"),
      messageCount: msgCount?.count ?? 0,
      conversationCount: convCount?.count ?? 0,
    });
  }

  res.json(days);
});

export default router;
