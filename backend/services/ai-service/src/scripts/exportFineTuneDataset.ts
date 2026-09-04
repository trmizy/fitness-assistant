/**
 * Exports REAL production signal into the repo-root `training/` fine-tuning
 * dataset format ({instruction, input, output, tags} JSONL — see
 * training/data/coach_instruction_schema.json).
 *
 * Only pulls rows that already carry an explicit positive quality signal:
 *   - Conversation rows with feedback === 1 (user thumbs-up)
 *   - WorkoutPlan rows with ptReviewStatus === 'PT_APPROVED' (human PT sign-off)
 *
 * This intentionally does NOT touch training/scripts/prepare_coach_dataset.py,
 * which by design "never reads production databases" — this script is the
 * opt-in bridge a human operator runs manually, then hands the output to that
 * script via training/data/raw/*.jsonl. Every row is anonymized before it
 * leaves this process: no userId, no PT/client names, and question/answer/plan
 * text is scrubbed for emails, phone numbers, and long digit sequences.
 *
 * Run inside the ai-service container (has the live DATABASE_URL):
 *   docker exec gymcoach-ai-dev pnpm run ai:export:finetune
 *
 * Writes under src/ (bind-mounted to the host) so the file is reachable from
 * outside the container; move/copy it into training/data/raw/ afterwards.
 */
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "../generated/prisma";

dotenv.config();

const prisma = new PrismaClient();

const OUT_PATH =
  process.env.EXPORT_OUT_PATH ||
  path.join(__dirname, ".output", "production-fine-tune-export.jsonl");

const MIN_ANSWER_LENGTH = 40;

function scrubPii(text: string): string {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\b(?:\+?\d[\d\s().-]{7,}\d)\b/g, "[phone]")
    .replace(/\b\d{8,}\b/g, "[number]");
}

type ExportRow = {
  instruction: string;
  input: string;
  output: string;
  tags: string[];
};

async function exportConversations(): Promise<ExportRow[]> {
  const rows = await prisma.conversation.findMany({
    where: {
      feedback: 1,
      answer: { not: "" },
    },
    select: {
      question: true,
      answer: true,
      routeIntent: true,
      responseLanguage: true,
      usedDeterministicFallback: true,
    },
    take: Number(process.env.EXPORT_CONVERSATION_LIMIT || "2000"),
    orderBy: { createdAt: "desc" },
  });

  return rows
    .filter((r) => r.answer.trim().length >= MIN_ANSWER_LENGTH)
    .map((r) => ({
      instruction: scrubPii(r.question.trim()),
      input: JSON.stringify({
        routeIntent: r.routeIntent ?? null,
        responseLanguage: r.responseLanguage ?? null,
      }),
      output: scrubPii(r.answer.trim()),
      tags: [
        "fitness",
        "coach",
        "source:production_conversation",
        "feedback:positive",
        r.usedDeterministicFallback
          ? "path:deterministic_fallback"
          : "path:llm",
      ],
    }));
}

async function exportApprovedPlans(): Promise<ExportRow[]> {
  const rows = await prisma.workoutPlan.findMany({
    where: {
      ptReviewStatus: "PT_APPROVED",
      status: "COMPLETED",
      archivedAt: null,
    },
    select: {
      goal: true,
      duration: true,
      daysPerWeek: true,
      plan: true,
    },
    take: Number(process.env.EXPORT_PLAN_LIMIT || "500"),
    orderBy: { updatedAt: "desc" },
  });

  return rows.map((r) => ({
    instruction: `Generate a ${r.duration}-week workout plan, goal=${r.goal}, ${r.daysPerWeek} days/week.`,
    input: JSON.stringify({
      goal: r.goal,
      durationWeeks: r.duration,
      daysPerWeek: r.daysPerWeek,
    }),
    output: scrubPii(JSON.stringify(r.plan)),
    tags: [
      "fitness",
      "coach",
      "source:production_workout_plan",
      "pt_approved",
    ],
  }));
}

async function main(): Promise<void> {
  const [conversations, plans] = await Promise.all([
    exportConversations(),
    exportApprovedPlans(),
  ]);
  const rows = [...conversations, ...plans];

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  const lines = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
  fs.writeFileSync(OUT_PATH, rows.length ? lines : "", "utf-8");

  console.log(
    JSON.stringify(
      {
        status: "OK",
        conversationsExported: conversations.length,
        plansExported: plans.length,
        totalRows: rows.length,
        outPath: OUT_PATH,
        note: "Anonymized (no userId/PT-name/client-name; email/phone/long-digit scrubbed). Review before copying into training/data/raw/.",
      },
      null,
      2,
    ),
  );
}

main()
  .catch((err) => {
    console.error("FAIL ai:export:finetune");
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
