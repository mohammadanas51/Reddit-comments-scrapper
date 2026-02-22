import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// ── Health Check (To verify deployment) ───────────────────────────
const APP_VERSION = "1.0.2-" + new Date().getTime();
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    version: APP_VERSION,
    env: IS_VERCEL ? "vercel" : "local",
  });
});

// ── Visitor Statistics Logic ──────────────────────────────────────
const IS_VERCEL = process.env.VERCEL || process.env.NOW_REGION;
const STATS_FILE = IS_VERCEL
  ? path.join("/tmp", "stats.json")
  : path.join(__dirname, "stats.json");

function getStats() {
  try {
    if (!fs.existsSync(STATS_FILE)) {
      return { visitorCount: 0 };
    }
    return JSON.parse(fs.readFileSync(STATS_FILE, "utf-8"));
  } catch (err) {
    console.error("Error reading stats:", err);
    return { visitorCount: 0 };
  }
}

function updateStats(stats) {
  try {
    fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2), "utf-8");
  } catch (err) {
    console.error("Error saving stats:", err);
  }
}

// Middleware to track visits
app.use((req, res, next) => {
  // Only track GET requests to the root "/"
  if (req.method === "GET" && req.path === "/") {
    const stats = getStats();
    stats.visitorCount++;
    updateStats(stats);
  }
  next();
});

app.use(express.static(path.join(__dirname, "public")));

// ── Helper: recursively extract comments ──────────────────────────
function extractComments(children) {
  const comments = [];
  for (const child of children) {
    if (child.kind === "t1") {
      const d = child.data;
      if (d.body) {
        comments.push({
          author: d.author ?? "[deleted]",
          body: d.body,
          score: d.score ?? 0,
          created_utc: d.created_utc ?? null,
        });
      }

      if (d.replies?.data?.children) {
        comments.push(...extractComments(d.replies.data.children));
      }
    }
  }
  return comments;
}

// ── Helper: normalise Reddit URL → .json endpoint ─────────────────
function toRedditJsonUrl(userUrl) {
  // Use www.reddit.com but preserve the full path if possible
  // Some Reddit filters are more aggressive on the shortened /comments/id URLs
  let cleaned = userUrl.split("?")[0].replace(/\/+$/, "");
  if (!cleaned.endsWith(".json")) cleaned += ".json";
  return cleaned.replace(/(old|mobile|pay)\.reddit\.com/, "www.reddit.com");
}

// ── POST /api/scrape ──────────────────────────────────────────────
app.post("/api/scrape", async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "URL is required" });

    const jsonUrl = toRedditJsonUrl(url);
    console.info(`[${new Date().toISOString()}] 🔍 SCRAPE REQUEST: ${jsonUrl}`);

    const response = await fetch(jsonUrl, {
      headers: {
        // Using a mobile iPhone UA - sometimes Reddit is more lenient with mobile users
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        Accept: "application/json",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: "https://www.google.com/",
        DNT: "1",
      },
    });

    if (!response.ok) {
      console.error(`❌ Reddit 403/Error: ${response.status} for ${jsonUrl}`);
      const textHint = await response.text();
      console.log(`📄 Response snippet: ${textHint.substring(0, 200)}`);
      return res
        .status(response.status)
        .json({ error: `Reddit returned status ${response.status}` });
    }

    const json = await response.json();
    console.log(`✅ Successfully fetched JSON for: ${jsonUrl}`);

    // Extract post info
    const postData = json[0]?.data?.children?.[0]?.data ?? {};
    const title = postData.title ?? "";
    const body = postData.selftext ?? "";

    // Extract comments
    const comments = extractComments(json[1]?.data?.children ?? []);

    res.json({ title, body, comments });
  } catch (err) {
    console.error("Scrape error:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// ── Private Stats Endpoint ────────────────────────────────────────
app.get("/admin/stats", (req, res) => {
  const { key } = req.query;
  // Simple "only I can see" check - the user can change this secret
  if (key !== "admin123") {
    return res.status(401).send("Unauthorized Access Denied.");
  }

  const stats = getStats();
  res.send(`
    <html>
      <head>
        <title>Admin Stats</title>
        <style>
          body { font-family: sans-serif; background: #0b0f19; color: #fff; display: flex; justify-content: center; align-items: center; height: 100vh; }
          .card { background: rgba(255,255,255,0.05); padding: 40px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1); text-align: center; }
          h1 { color: #6366f1; margin-bottom: 10px; }
          .count { font-size: 3rem; font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>Total Visitors</h1>
          <div class="count">${stats.visitorCount}</div>
        </div>
      </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
