import { Router, type IRouter } from "express";
import healthRouter from "./health";
import publicRouter from "./public";
import authRouter from "./auth";
import adminRouter from "./admin";
import whatsappRouter from "./whatsapp";
import contactsRouter from "./contacts";
import campaignsRouter from "./campaigns";
import chatbotsRouter from "./chatbots";
import dashboardRouter from "./dashboard";
import mediaRouter from "./media";
import followUpsRouter from "./follow-ups";
import couponsRouter from "./coupons";
import trackingRouter from "./tracking";
import funnelRouter from "./funnel";
import plansRouter from "./plans";
import leadsRouter from "./leads";
import aiRouter from "./ai";
import settingsRouter from "./settings";
import diagnosticsRouter from "./diagnostics";

const router: IRouter = Router();

router.use(healthRouter);
router.use(publicRouter);       // public routes — no auth required
router.use("/auth", authRouter);
router.use("/admin", adminRouter);
router.use("/whatsapp", whatsappRouter);
router.use("/contacts", contactsRouter);
router.use("/campaigns", campaignsRouter);
router.use("/chatbots", chatbotsRouter);
router.use("/dashboard", dashboardRouter);
router.use("/media", mediaRouter);
router.use("/follow-ups", followUpsRouter);
router.use("/coupons", couponsRouter);
router.use("/tracking", trackingRouter);
router.use("/funnel", funnelRouter);
router.use("/plans", plansRouter);
router.use("/leads", leadsRouter);
router.use("/ai", aiRouter);
router.use("/settings", settingsRouter);
router.use("/diagnostics", diagnosticsRouter);

export default router;
