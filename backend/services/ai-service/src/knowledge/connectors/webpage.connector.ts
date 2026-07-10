import axios from "axios";
import type {
  NormalizedResearchRecord,
  ResearchConnector,
  ResearchConnectorFetchOptions,
} from "./connector.interface";

function allowedHosts(): Set<string> {
  return new Set(
    (process.env.RESEARCH_WEB_ALLOWLIST || "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
}

async function robotsAllows(
  url: URL,
  userAgent: string,
  timeoutMs: number,
): Promise<boolean> {
  const robotsUrl = `${url.protocol}//${url.host}/robots.txt`;
  try {
    const response = await axios.get(robotsUrl, {
      timeout: timeoutMs,
      headers: { "User-Agent": userAgent },
    });
    const lines = String(response.data || "").split(/\r?\n/);
    let applies = false;
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const [key, ...rest] = line.split(":");
      const value = rest.join(":").trim();
      if (/^user-agent$/i.test(key))
        applies =
          value === "*" ||
          userAgent.toLowerCase().includes(value.toLowerCase());
      if (
        applies &&
        /^disallow$/i.test(key) &&
        value &&
        url.pathname.startsWith(value)
      )
        return false;
    }
    return true;
  } catch {
    return false;
  }
}

export const webpageConnector: ResearchConnector = {
  id: "allowlisted_webpage",
  async fetch(
    options: ResearchConnectorFetchOptions,
  ): Promise<NormalizedResearchRecord[]> {
    const url = new URL(options.source.base_url);
    if (!allowedHosts().has(url.host.toLowerCase())) return [];
    if (
      options.source.robots_policy_required &&
      !(await robotsAllows(url, options.userAgent, options.timeoutMs))
    )
      return [];

    const response = await axios.get(url.toString(), {
      timeout: options.timeoutMs,
      headers: { "User-Agent": options.userAgent },
    });
    const html = String(response.data || "");
    const title = (
      html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || url.hostname
    ).trim();
    const description = (
      html.match(
        /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i,
      )?.[1] || title
    ).trim();
    const fetchedAt = new Date().toISOString();
    return [
      {
        external_id: `web:${url.toString()}`,
        title,
        abstract_or_summary: description,
        source: options.source.name,
        source_url: url.toString(),
        publisher: url.hostname,
        access_status: "metadata",
        topic: options.topic.id,
        raw_metadata: { title, description },
        fetched_at: fetchedAt,
        retrieved_at: fetchedAt,
      },
    ];
  },
};
