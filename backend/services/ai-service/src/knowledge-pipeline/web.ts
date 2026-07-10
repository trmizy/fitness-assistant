import axios from "axios";
import * as cheerio from "cheerio";
import { KNOWLEDGE_PIPELINE } from "./config";
import { sha256 } from "./hash";
import type { KnowledgeSource, RawKnowledgeDocument } from "./types";

type RobotsRules = {
  allow: string[];
  disallow: string[];
};

const robotsCache = new Map<string, RobotsRules>();
const lastFetchByOrigin = new Map<string, number>();

function normalizePathForRobots(url: string): string {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

function parseRobotsTxt(text: string): RobotsRules {
  const rules: RobotsRules = { allow: [], disallow: [] };
  let applies = false;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/#.*/, "").trim();
    if (!line) continue;

    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (key === "user-agent") {
      const agent = value.toLowerCase();
      applies =
        agent === "*" ||
        KNOWLEDGE_PIPELINE.userAgent.toLowerCase().includes(agent);
      continue;
    }

    if (!applies) continue;
    if (key === "allow" && value) rules.allow.push(value);
    if (key === "disallow" && value) rules.disallow.push(value);
  }

  return rules;
}

function pathMatchesRule(pathname: string, rule: string): boolean {
  if (!rule) return false;
  if (rule === "/") return true;
  return pathname.startsWith(rule.replace(/\*.*$/, ""));
}

export function isAllowedByRobots(url: string, rules: RobotsRules): boolean {
  const path = normalizePathForRobots(url);
  const allowMatch = rules.allow.find((rule) => pathMatchesRule(path, rule));
  const disallowMatch = rules.disallow.find((rule) =>
    pathMatchesRule(path, rule),
  );

  if (!disallowMatch) return true;
  if (!allowMatch) return false;
  return allowMatch.length >= disallowMatch.length;
}

async function getRobotsRules(url: string): Promise<RobotsRules> {
  const origin = new URL(url).origin;
  const cached = robotsCache.get(origin);
  if (cached) return cached;

  try {
    const response = await axios.get(`${origin}/robots.txt`, {
      timeout: 8000,
      headers: { "User-Agent": KNOWLEDGE_PIPELINE.userAgent },
    });
    const rules = parseRobotsTxt(String(response.data ?? ""));
    robotsCache.set(origin, rules);
    return rules;
  } catch {
    const permissive: RobotsRules = { allow: [], disallow: [] };
    robotsCache.set(origin, permissive);
    return permissive;
  }
}

async function waitForOriginRateLimit(url: string): Promise<void> {
  const origin = new URL(url).origin;
  const now = Date.now();
  const last = lastFetchByOrigin.get(origin) ?? 0;
  const waitMs = Math.max(0, KNOWLEDGE_PIPELINE.webRateLimitMs - (now - last));
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  lastFetchByOrigin.set(origin, Date.now());
}

function extractReadableText(html: string): {
  title: string;
  text: string;
  publishedAt: Date | null;
  tags: string[];
} {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg, nav, footer, header, form, aside").remove();

  const title = (
    $('meta[property="og:title"]').attr("content") ||
    $("h1").first().text() ||
    $("title").first().text() ||
    "Untitled web document"
  )
    .replace(/\s+/g, " ")
    .trim();

  const description = (
    $('meta[name="description"]').attr("content") ||
    $('meta[property="og:description"]').attr("content") ||
    ""
  )
    .replace(/\s+/g, " ")
    .trim();

  const publishedRaw =
    $('meta[property="article:published_time"]').attr("content") ||
    $("time[datetime]").first().attr("datetime") ||
    "";
  const publishedDate = publishedRaw ? new Date(publishedRaw) : null;
  const publishedAt =
    publishedDate && !Number.isNaN(publishedDate.getTime())
      ? publishedDate
      : null;

  const tags = [
    ...($('meta[name="keywords"]').attr("content") ?? "").split(","),
    ...$('a[rel="tag"], .tag, .tags a')
      .map((_, el) => $(el).text())
      .get(),
  ]
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 12);

  const bodyText = $("main article, article, main, body")
    .first()
    .find("h2, h3, p, li")
    .map((_, el) => $(el).text())
    .get()
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter((item) => item.length >= 30)
    .join("\n");

  const text = [description, bodyText].filter(Boolean).join("\n").trim();
  return { title, text, publishedAt, tags: Array.from(new Set(tags)) };
}

export function parseWebDocumentFromHtml(
  html: string,
  source: KnowledgeSource,
  url = source.baseUrl,
): RawKnowledgeDocument | null {
  const extracted = extractReadableText(html);
  if (extracted.text.length < 250) return null;

  return {
    sourceId: source.id,
    url,
    title: extracted.title,
    author: null,
    language: "en",
    contentHash: sha256(
      [source.id, url, extracted.title, extracted.text].join("\n"),
    ),
    rawObjectKey: url,
    cleanText: [extracted.title, extracted.text].join("\n"),
    sourceFile: url,
    sourceType: "web",
    evidenceLevel:
      source.trustTier <= 2 ? "professional_source" : "general_web",
    tags: extracted.tags,
    publishedAt: extracted.publishedAt,
  };
}

export async function fetchWebDocument(
  source: KnowledgeSource,
): Promise<RawKnowledgeDocument[]> {
  const rules = await getRobotsRules(source.baseUrl);
  if (!isAllowedByRobots(source.baseUrl, rules)) {
    throw new Error(`robots.txt disallows crawling ${source.baseUrl}`);
  }

  await waitForOriginRateLimit(source.baseUrl);
  const response = await axios.get(source.baseUrl, {
    timeout: 20000,
    headers: { "User-Agent": KNOWLEDGE_PIPELINE.userAgent },
  });

  const doc = parseWebDocumentFromHtml(String(response.data ?? ""), source);
  return doc ? [doc] : [];
}
