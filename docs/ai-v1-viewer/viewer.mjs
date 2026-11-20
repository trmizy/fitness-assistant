import { flows } from "./flows.mjs";

const diagram = document.querySelector("#diagram");
const inspector = document.querySelector(".inspector");
const navigation = [...document.querySelectorAll(".flow-nav a")];
const svgNS = "http://www.w3.org/2000/svg";
const shapes = {
  default: "M4 4h12v12H4z M7 10h6",
  data: "M4 6c0-3 12-3 12 0v8c0 3-12 3-12 0z M4 6c0 3 12 3 12 0 M4 10c0 3 12 3 12 0",
  gate: "M10 2l7 4v7l-7 5-7-5V6z M7 10l2 2 4-4",
  model: "M10 2l2.25 5.75L18 10l-5.75 2.25L10 18l-2.25-5.75L2 10l5.75-2.25z",
  api: "M3 6h14v8H3z M6 10h2 M11 10h3",
  branch: "M4 5h4v10h8 M8 10h8 M14 8l2 2-2 2 M14 13l2 2-2 2",
};

let flowKey;
let flow;
let selected;
let coordinates = new Map();
let buttons = new Map();

function svgElement(type, attrs = {}) {
  const element = document.createElementNS(svgNS, type);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
  return element;
}

function icon(kind) {
  let shape = shapes.default;
  if (["Lưu trữ", "Dữ liệu", "Dữ kiện", "Nguồn dữ liệu"].includes(kind)) shape = shapes.data;
  if (["An toàn", "Kiểm soát", "Xác nhận"].includes(kind)) shape = shapes.gate;
  if (["LLM", "Mô hình", "Provider", "Sinh phản hồi", "Diễn giải"].includes(kind)) shape = shapes.model;
  if (["Giao diện", "Giao vận", "API", "Đầu vào"].includes(kind)) shape = shapes.api;
  if (["Tác vụ nền", "Theo điều kiện", "Điều phối"].includes(kind)) shape = shapes.branch;
  const svg = svgElement("svg", { viewBox: "0 0 20 20", "aria-hidden": "true" });
  svg.append(svgElement("path", { d: shape }));
  return svg;
}

function makeNode(node, column, row) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "diagram-node";
  button.dataset.node = node.id;
  button.style.gridColumn = column + 1;
  button.innerHTML = '<span class="node-label"></span><span class="node-caption"></span>';
  button.prepend(icon(node.kind));
  button.querySelector(".node-label").textContent = node.label;
  button.querySelector(".node-caption").textContent = node.kind;
  button.addEventListener("click", () => {
    history.pushState(null, "", `#${flowKey}/${node.id}`);
    setSelected(node.id);
    if (matchMedia("(max-width: 48rem)").matches) inspector.scrollIntoView({ block: "nearest" });
  });
  coordinates.set(node.id, { node, column, row });
  buttons.set(node.id, button);
  return button;
}

function marker(id) {
  const end = svgElement("marker", {
    id, viewBox: "0 0 10 10", refX: "8", refY: "5",
    markerWidth: "8", markerHeight: "8", markerUnits: "userSpaceOnUse", orient: "auto-start-reverse",
  });
  end.append(svgElement("path", { d: "M1 1l6 4-6 4", class: id === "active-arrow" ? "marker active" : "marker" }));
  return end;
}

function connection(start, end, origin) {
  const a = buttons.get(start).getBoundingClientRect();
  const b = buttons.get(end).getBoundingClientRect();
  const first = coordinates.get(start);
  const second = coordinates.get(end);
  if (first.row === second.row) {
    if (Math.abs(first.column - second.column) > 1) {
      const startX = a.left + a.width / 2 - origin.left;
      const endX = b.left + b.width / 2 - origin.left;
      const bendsAt = Math.max(a.bottom, b.bottom) - origin.top + 12;
      return `M ${startX} ${a.bottom - origin.top} V ${bendsAt} H ${endX} V ${b.bottom - origin.top + 4}`;
    }
    const forward = first.column < second.column;
    const y = a.top + a.height / 2 - origin.top;
    return `M ${(forward ? a.right : a.left) - origin.left} ${y} H ${(forward ? b.left - 4 : b.right + 4) - origin.left}`;
  }
  const down = first.row < second.row;
  const startX = a.left + a.width / 2 - origin.left;
  const endX = b.left + b.width / 2 - origin.left + (first.column - second.column) * 7;
  const startY = (down ? a.bottom : a.top) - origin.top;
  const endY = (down ? b.top - 4 : b.bottom + 4) - origin.top;

  if (Math.abs(first.row - second.row) > 1) {
    const outside = origin.width - 10;
    const startBend = startY + (down ? 12 : -12);
    const endBend = endY + (down ? -12 : 12);
    return `M ${startX} ${startY} V ${startBend} H ${outside} V ${endBend} H ${endX} V ${endY}`;
  }
  const middle = startY + (endY - startY) * (0.34 + first.column * 0.13);
  return `M ${startX} ${startY} V ${middle} H ${endX} V ${endY}`;
}

function drawEdges() {
  const origin = diagram.getBoundingClientRect();
  const layer = diagram.querySelector(".edges");
  if (!layer || !flow) return;
  layer.setAttribute("viewBox", `0 0 ${origin.width} ${origin.height}`);
  const defs = svgElement("defs");
  defs.append(marker("arrow"), marker("active-arrow"));
  const edges = flow.edges.map(([start, end, conditional]) => {
    const active = start === selected || end === selected;
    return svgElement("path", {
      d: connection(start, end, origin),
      class: ["edge", conditional, active && "active"].filter(Boolean).join(" "),
      "marker-end": active ? "url(#active-arrow)" : "url(#arrow)",
    });
  });
  layer.replaceChildren(defs, ...edges);
}

function setSelected(id) {
  selected = coordinates.has(id) ? id : flow.selected;
  for (const [key, button] of buttons) button.setAttribute("aria-pressed", String(key === selected));
  const { node } = coordinates.get(selected);
  document.querySelector("#node-title").textContent = node.label;
  document.querySelector("#node-kind").textContent = node.kind;
  document.querySelector("#node-description").textContent = node.description;
  document.querySelector("#node-input").textContent = node.input;
  document.querySelector("#node-output").textContent = node.output;
  document.querySelector("#node-source").textContent = node.source.replace("/src/../", "/");
  const reportAnchor = node.section ? `muc-${node.section}` : flow.reportAnchor ?? `muc-${flow.section}`;
  document.querySelector("#node-link").href = `/bao-cao#${reportAnchor}`;
  drawEdges();
}

function showFlow() {
  const [requested, id] = location.hash.slice(1).split("/");
  if (requested === "main" && flowKey) return;
  const next = Object.hasOwn(flows, requested) ? requested : "kien-truc";
  if (next !== flowKey) {
    flowKey = next;
    flow = flows[next];
    coordinates = new Map();
    buttons = new Map();
    for (const link of navigation) {
      if (link.hash === `#${next}`) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    }
    document.querySelector("#flow-title").textContent = flow.title;
    document.querySelector("#flow-summary").textContent = flow.summary;
    const note = document.querySelector("#flow-note");
    note.textContent = flow.note ?? "";
    note.hidden = !flow.note;
    diagram.setAttribute("aria-label", flow.title);
    document.querySelector("#diagram-key").hidden = !flow.edges.some((edge) => edge[2]);

    const layer = svgElement("svg", { class: "edges", "aria-hidden": "true" });
    const bands = flow.rows.map(([title, nodes], row) => {
      const band = document.createElement("section");
      band.className = "diagram-band";
      const heading = document.createElement("h3");
      heading.textContent = title;
      const grid = document.createElement("div");
      grid.className = "diagram-row";
      nodes.forEach((node, column) => {
        if (node) grid.append(makeNode(node, column, row));
      });
      band.append(heading, grid);
      return band;
    });
    diagram.replaceChildren(layer, ...bands);
  }
  setSelected(id);
}

window.addEventListener("hashchange", showFlow);
new ResizeObserver(drawEdges).observe(diagram);
showFlow();
