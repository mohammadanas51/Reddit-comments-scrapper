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

// ── Visitor Statistics Logic ──────────────────────────────────────
const STATS_FILE = path.join(__dirname, "stats.json");

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
  let cleaned = userUrl.split("?")[0].replace(/\/+$/, "");
  if (!cleaned.endsWith(".json")) cleaned += ".json";
  return cleaned;
}

// ── POST /api/scrape ──────────────────────────────────────────────
app.post("/api/scrape", async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "URL is required" });

    const jsonUrl = toRedditJsonUrl(url);

    const response = await fetch(jsonUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; RedditScraper/1.0)",
      },
    });

    if (!response.ok) {
      return res
        .status(response.status)
        .json({ error: `Reddit returned status ${response.status}` });
    }

    const json = await response.json();

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
