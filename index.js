import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import "dotenv/config";

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

// ── Reddit OAuth Logic ────────────────────────────────────────────
let cachedToken = null;
let tokenExpiry = 0;

async function getRedditToken() {
  const { REDDIT_CLIENT_ID: id, REDDIT_CLIENT_SECRET: secret } = process.env;

  if (!id || !secret) {
    console.error(
      "❌ ERROR: REDDIT_CLIENT_ID or REDDIT_CLIENT_SECRET is missing!",
    );
    return null;
  }

  // Use cached token if still valid (minus 60s buffer)
  if (cachedToken && Date.now() < tokenExpiry - 60000) {
    return cachedToken;
  }

  try {
    const auth = Buffer.from(`${id}:${secret}`).toString("base64");
    const response = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent":
          "web:reddit-comment-scraper:v1.0.0 (by /u/anas-scraper-bot)",
      },
      body: new URLSearchParams({ grant_type: "client_credentials" }),
    });

    const data = await response.json();
    if (data.access_token) {
      cachedToken = data.access_token;
      tokenExpiry = Date.now() + data.expires_in * 1000;
      console.info("🔑 New Reddit OAuth token acquired.");
      return cachedToken;
    }
    console.error("❌ Failed to get Reddit token:", data);
  } catch (err) {
    console.error("❌ OAuth Error:", err);
  }
  return null;
}

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
  // Extract the subreddit and comment ID
  // Format: /r/{sub}/comments/{id}
  const match = userUrl.match(/\/r\/([^/]+)\/comments\/([^/]+)/i);
  if (match) {
    return `https://oauth.reddit.com/r/${match[1]}/comments/${match[2]}`;
  }

  // Fallback for shortened or mobile links
  const shortMatch = userUrl.match(/\/comments\/([^/]+)/i);
  if (shortMatch) {
    return `https://oauth.reddit.com/comments/${shortMatch[1]}`;
  }

  return null;
}

// ── POST /api/scrape ──────────────────────────────────────────────
app.post("/api/scrape", async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "URL is required" });

    const jsonUrl = toRedditJsonUrl(url);
    if (!jsonUrl)
      return res.status(400).json({ error: "Invalid Reddit URL format" });

    console.info(
      `[${new Date().toISOString()}] 🔍 AUTHENTICATED REQUEST: ${jsonUrl}`,
    );

    const token = await getRedditToken();
    if (!token) {
      return res
        .status(500)
        .json({
          error: "Could not authenticate with Reddit. Check API credentials.",
        });
    }

    const response = await fetch(jsonUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent":
          "web:reddit-comment-scraper:v1.0.0 (by /u/anas-scraper-bot)",
      },
    });

    if (!response.ok) {
      console.error(`❌ Reddit API Error: ${response.status} for ${jsonUrl}`);
      const textHint = await response.text();
      console.log(`📄 Response snippet: ${textHint.substring(0, 200)}`);
      return res
        .status(response.status)
        .json({ error: `Reddit API returned status ${response.status}` });
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
