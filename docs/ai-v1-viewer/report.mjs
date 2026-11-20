import { posix } from "node:path";

const commit = "4cde78f7d1d26347fe0de1d8787f0217e81b42ab";
const diagrams = new Map([[2, "kien-truc"], [4, "xac-nhan"], [7, "sinh-ke-hoach"], [11, "harness"]]);
const workspaceOnly = "test/research/inbody-rag-paper/";
const fence = String.fromCharCode(96).repeat(3);

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function slug(value) {
  return value.trim().toLowerCase().replace(/[^\p{L}\p{M}\p{N} _-]/gu, "").replaceAll(" ", "-");
}

function sourceLink(label, href) {
  const text = escapeHtml(label);
  if (href.startsWith("#")) return '<a href="' + escapeHtml(href) + '">' + text + "</a>";

  const path = posix.normalize(posix.join("docs", href));
  if (/^(backend|frontend|test|training)\/[a-z0-9_./-]+$/i.test(path) && !path.startsWith(workspaceOnly)) {
    const url = "https://github.com/trmizy/fitness-assistant/blob/" + commit + "/" + path;
    return '<a href="' + escapeHtml(url) + '">' + text + "</a>";
  }
  return '<span class="source-ref" title="' + escapeHtml(path) + '">' + text + "</span>";
}

function inline(line) {
  const token = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)]\(([^)]+)\)/g;
  let html = "";
  let offset = 0;
  for (const match of line.matchAll(token)) {
    html += escapeHtml(line.slice(offset, match.index));
    if (match[1]) html += "<code>" + escapeHtml(match[1]) + "</code>";
    else if (match[2]) html += "<strong>" + inline(match[2]) + "</strong>";
    else html += sourceLink(match[3], match[4]);
    offset = match.index + match[0].length;
  }
  return html + escapeHtml(line.slice(offset));
}

function renderTable(lines) {
  const cells = (line, tag) => line.slice(1, -1).split("|").map((cell) => {
    const attrs = tag === "th" ? ' scope="col"' : "";
    return "<" + tag + attrs + ">" + inline(cell.trim()) + "</" + tag + ">";
  }).join("");
  const header = "<thead><tr>" + cells(lines[0], "th") + "</tr></thead>";
  const body = lines.slice(2).map((line) => "<tr>" + cells(line, "td") + "</tr>").join("");
  return '<div class="table-wrap"><table>' + header + "<tbody>" + body + "</tbody></table></div>";
}

export function renderReport(markdown) {
  const lines = markdown.split(/\r?\n/);
  const contents = [];
  const body = [];
  let section = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line || /^# /.test(line) || line.startsWith("[Kiến trúc]")) continue;
    const heading = /^(#{2,3}) (.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const title = heading[2];
      if (level === 2) {
        section = Number.parseInt(title, 10);
        contents.push('<li><a href="#muc-' + section + '">' + escapeHtml(title.replace(/^\d+\. /, "")) + '</a></li>');
        body.push('<span id="muc-' + section + '" class="report-alias"></span>');
      }
      body.push("<h" + level + ' id="' + escapeHtml(slug(title)) + '">' + inline(title) + "</h" + level + ">");
      continue;
    }
    if (line.startsWith(fence)) {
      const code = [];
      while (index + 1 < lines.length && lines[index + 1].trim() !== fence) code.push(lines[++index]);
      index += 1;
      if (line.slice(fence.length) === "mermaid" && diagrams.has(section)) {
        body.push('<a class="report-diagram" href="/#' + diagrams.get(section) + '">Mở sơ đồ tương tác</a>');
        body.push("<details><summary>Mã Mermaid</summary><pre><code>" + escapeHtml(code.join("\n")) + "</code></pre></details>");
      } else {
        body.push("<pre><code>" + escapeHtml(code.join("\n")) + "</code></pre>");
      }
      continue;
    }
    if (line.startsWith("|") && lines[index + 1]?.trim().startsWith("| ---")) {
      const rows = [line];
      while (lines[index + 1]?.trim().startsWith("|")) rows.push(lines[++index].trim());
      body.push(renderTable(rows));
      continue;
    }
    const bullet = /^(?:- |\d+\. )/;
    if (bullet.test(line)) {
      const tag = line.startsWith("- ") ? "ul" : "ol";
      const prefix = tag === "ul" ? /^- / : /^\d+\. /;
      const items = [line];
      while (prefix.test(lines[index + 1]?.trim() ?? "")) items.push(lines[++index].trim());
      body.push("<" + tag + ">" + items.map((item) => "<li>" + inline(item.replace(prefix, "")) + "</li>").join("") + "</" + tag + ">");
      continue;
    }
    body.push("<p>" + inline(line) + "</p>");
  }
  return { contents: contents.join(""), body: body.join("\n") };
}
