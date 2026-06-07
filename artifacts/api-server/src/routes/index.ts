import { Router, type IRouter } from "express";
import healthRouter from "./health";
import openaiRouter from "./openai";
import dashboardRouter from "./dashboard";
import backendLogsRouter from "./backend-logs";
import keywordRotationRouter from "./keyword-rotation";
import rankingsRouter from "./rankings";
import healthMonitorRouter from "./health-monitor";
import dailyOverviewRouter from "./daily-overview";
import csvRouter from "./csv";
import archiveRouter from "./archive-route";

const router: IRouter = Router();

router.use(healthRouter);
router.use(openaiRouter);
router.use(dashboardRouter);
router.use(backendLogsRouter);
router.use(keywordRotationRouter);
router.use(rankingsRouter);
router.use(healthMonitorRouter);
router.use(dailyOverviewRouter);
router.use(csvRouter);
router.use(archiveRouter);

export default router;
