import express from "express";
import { metricsMiddleware, register } from "@gym-coach/shared";
import exerciseRoutes from "./routes/exercise.routes";
import workoutRoutes from "./routes/workout.routes";
import nutritionRoutes from "./routes/nutrition.routes";
import statsRoutes from "./routes/stats.routes";
import foodRoutes from "./routes/food.routes";
import internalRoutes from "./routes/internal.routes";
import trainingCycleRoutes from "./routes/training-cycle.routes";
import coachRoutes from "./routes/coach.routes";
import equipmentRoutes from "./routes/equipment.routes";
import importRoutes from "./routes/import.routes";
import exportRoutes from "./routes/export.routes";

const app = express();

// Roadmap P2 "Canonical import framework" — a Hevy CSV export posted as a
// JSON string field can be a few MB of text, well past the default
// express.json() 100kb limit every other route in this service is fine
// with. Scoped to just this path, registered BEFORE the general default
// below, so it (not the 100kb one) parses the body for /imports/* — no
// change to every other route's limit.
app.use("/imports", express.json({ limit: "15mb" }));
app.use(express.json());
app.use(metricsMiddleware());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "fitness-service" });
});

app.get("/metrics", async (_req, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});

app.use("/exercises", exerciseRoutes);
app.use("/workouts", workoutRoutes);
app.use("/nutrition", nutritionRoutes);
app.use("/stats", statsRoutes);
app.use("/food", foodRoutes);
app.use("/internal", internalRoutes);
app.use("/training-cycles", trainingCycleRoutes);
app.use("/coach", coachRoutes);
app.use("/equipment", equipmentRoutes);
app.use("/imports", importRoutes);
app.use("/exports", exportRoutes);

export default app;
