// Generates stats/stats.svg and stats/languages.svg from the GitHub REST API.
// Uses REST (commit search, repo languages) instead of the GraphQL contribution
// calendar, which can under-report for some accounts.
import { mkdirSync, writeFileSync } from "node:fs";

const USER = process.env.GH_USER || "yughiyami";
const TOKEN = process.env.GITHUB_TOKEN;
const EXCLUDE_LANGS = new Set((process.env.EXCLUDE_LANGS || "").split(",").filter(Boolean));

const headers = {
  Accept: "application/vnd.github+json",
  "User-Agent": "profile-stats",
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
};

async function api(path) {
  const res = await fetch(`https://api.github.com${path}`, { headers });
  if (!res.ok) throw new Error(`GitHub API ${path} -> ${res.status}`);
  return res.json();
}

async function ownedRepos() {
  const repos = [];
  for (let page = 1; ; page++) {
    const batch = await api(`/users/${USER}/repos?type=owner&per_page=100&page=${page}`);
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  return repos.filter((r) => !r.fork);
}

const LANG_COLORS = {
  TypeScript: "#3178c6", JavaScript: "#f1e05a", Python: "#3572A5", Java: "#b07219",
  Kotlin: "#A97BFF", HTML: "#e34c26", CSS: "#563d7c", "C#": "#178600", "C++": "#f34b7d",
  C: "#555555", Dart: "#00B4AB", "Jupyter Notebook": "#DA5B0B", Perl: "#0298c3",
  TeX: "#3D6117", Solidity: "#AA6746", Shell: "#89e051", Svelte: "#ff3e00",
  "Wolfram Language": "#dd1100", PLpgSQL: "#336790", Dockerfile: "#384d54",
};
const FALLBACK = "#8b949e";

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const THEME = { bg: "#1a1b27", title: "#70a5fd", text: "#38bdae", value: "#c9d1d9", border: "#2b2d3f" };
const FONT = "font-family=\"'Segoe UI', Ubuntu, 'Helvetica Neue', Arial, sans-serif\"";

function card(width, height, title, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}">
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="6" fill="${THEME.bg}" stroke="${THEME.border}"/>
  <text x="25" y="35" ${FONT} font-size="18" font-weight="600" fill="${THEME.title}">${esc(title)}</text>
${body}
</svg>
`;
}

function statsSvg(rows) {
  const body = rows
    .map(
      ([label, value], i) => `  <text x="25" y="${72 + i * 26}" ${FONT} font-size="14" fill="${THEME.text}">${esc(label)}</text>
  <text x="300" y="${72 + i * 26}" ${FONT} font-size="14" font-weight="600" fill="${THEME.value}" text-anchor="end">${esc(value)}</text>`
    )
    .join("\n");
  return card(325, 72 + rows.length * 26 + 5, `${USER === "yughiyami" ? "Daniel" : USER}'s GitHub stats`, body);
}

function languagesSvg(langs) {
  const total = langs.reduce((sum, [, bytes]) => sum + bytes, 0) || 1;
  const width = 325;
  const barX = 25;
  const barW = width - 50;
  let x = barX;
  const segments = langs
    .map(([name, bytes]) => {
      const w = (bytes / total) * barW;
      const seg = `<rect x="${x.toFixed(2)}" y="52" width="${Math.max(w, 1).toFixed(2)}" height="10" fill="${LANG_COLORS[name] || FALLBACK}"/>`;
      x += w;
      return seg;
    })
    .join("\n    ");
  const legend = langs
    .map(([name, bytes], i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const lx = barX + col * 145;
      const ly = 92 + row * 24;
      const pct = ((bytes / total) * 100).toFixed(1);
      return `  <circle cx="${lx + 5}" cy="${ly - 4}" r="5" fill="${LANG_COLORS[name] || FALLBACK}"/>
  <text x="${lx + 16}" y="${ly}" ${FONT} font-size="12" fill="${THEME.text}">${esc(name)} <tspan fill="${THEME.value}" font-weight="600">${pct}%</tspan></text>`;
    })
    .join("\n");
  const rows = Math.ceil(langs.length / 2);
  const body = `  <clipPath id="bar"><rect x="${barX}" y="52" width="${barW}" height="10" rx="5"/></clipPath>
  <g clip-path="url(#bar)">
    ${segments}
  </g>
${legend}`;
  return card(width, 92 + rows * 24 + 4, "Top languages (by code size)", body);
}

const repos = await ownedRepos();

const [commits, prs, issues] = await Promise.all([
  api(`/search/commits?q=author:${USER}&per_page=1`),
  api(`/search/issues?q=author:${USER}+type:pr&per_page=1`),
  api(`/search/issues?q=author:${USER}+type:issue&per_page=1`),
]);

const stars = repos.reduce((sum, r) => sum + r.stargazers_count, 0);

const langBytes = new Map();
for (const repo of repos) {
  const langs = await api(`/repos/${USER}/${repo.name}/languages`);
  for (const [name, bytes] of Object.entries(langs)) {
    if (EXCLUDE_LANGS.has(name)) continue;
    langBytes.set(name, (langBytes.get(name) || 0) + bytes);
  }
}
const topLangs = [...langBytes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);

mkdirSync("stats", { recursive: true });
writeFileSync(
  "stats/stats.svg",
  statsSvg([
    ["Public repositories", repos.length],
    ["Total commits", commits.total_count],
    ["Pull requests", prs.total_count],
    ["Issues", issues.total_count],
    ["Stars earned", stars],
  ])
);
writeFileSync("stats/languages.svg", languagesSvg(topLangs));

console.log(
  JSON.stringify({ repos: repos.length, commits: commits.total_count, prs: prs.total_count, issues: issues.total_count, stars, topLangs: topLangs.map(([n]) => n) })
);
