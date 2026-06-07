import { Router } from "express";
import {
  getArchivedBusinesses,
  archiveBusiness,
  reactivateBusiness,
  getAllRankings,
  getAllDailyAnalysis,
} from "../lib/csv-data.js";

const router = Router();

/** GET /csv/archive — list all archived businesses with their last-known data */
router.get("/csv/archive", (_req, res) => {
  try {
    const archived = getArchivedBusinesses();
    res.json({ archived, total: archived.length });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** POST /csv/archive — archive a business { bizName: string } */
router.post("/csv/archive", (req, res) => {
  try {
    const { bizName } = req.body as { bizName?: string };
    if (!bizName?.trim()) { res.status(400).json({ error: "bizName required" }); return; }
    archiveBusiness(bizName.trim());
    res.json({ success: true, bizName: bizName.trim() });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** DELETE /csv/archive/:bizName — reactivate a business */
router.delete("/csv/archive/:bizName", (req, res) => {
  try {
    const bizName = decodeURIComponent(req.params["bizName"] ?? "").trim();
    if (!bizName) { res.status(400).json({ error: "bizName required" }); return; }
    const ok = reactivateBusiness(bizName);
    if (!ok) { res.status(404).json({ error: `"${bizName}" is not in the archive` }); return; }
    res.json({ success: true, bizName });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
