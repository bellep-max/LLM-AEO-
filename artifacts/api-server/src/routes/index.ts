import { Router, type IRouter } from "express";
import healthRouter from "./health";
import openaiRouter from "./openai";
import dashboardRouter from "./dashboard";
import backendLogsRouter from "./backend-logs";
import keywordRotationRouter from "./keyword-rotation";

const router: IRouter = Router();

router.use(healthRouter);
router.use(openaiRouter);
router.use(dashboardRouter);
router.use(backendLogsRouter);
router.use(keywordRotationRouter);

export default router;
