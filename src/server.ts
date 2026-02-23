import express from "express";
import https from "https";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import {
  createSchwabAuth,
  type EnhancedTokenManager,
} from "@sudowealth/schwab-api";
import { calculateGEX, getExpirationDates } from "./gex.js";
import "dotenv/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const app = express();
const PORT = process.env.PORT || 3000;
const REDIRECT_URI = `https://127.0.0.1:${PORT}/auth/callback`;
const TOKEN_FILE = path.join(projectRoot, ".tokens.json");

let schwabAuth: EnhancedTokenManager | null = null;

function saveTokens(tokens: any) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
}

function loadTokens(): any | null {
  if (!fs.existsSync(TOKEN_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8"));
  } catch {
    return null;
  }
}

function initAuth() {
  schwabAuth = createSchwabAuth({
    oauthConfig: {
      clientId: process.env.SCHWAB_CLIENT_ID!,
      clientSecret: process.env.SCHWAB_CLIENT_SECRET!,
      redirectUri: REDIRECT_URI,
      save: async (tokens) => {
        saveTokens(tokens);
        console.log("Tokens saved to .tokens.json");
      },
      load: async () => {
        const tokens = loadTokens();
        if (tokens) console.log("Tokens loaded from .tokens.json");
        return tokens;
      },
    },
  });
}

initAuth();

function ensureCerts() {
  const certDir = path.join(projectRoot, "certs");
  const keyPath = path.join(certDir, "key.pem");
  const certPath = path.join(certDir, "cert.pem");

  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
  }

  fs.mkdirSync(certDir, { recursive: true });
  console.log("Generating self-signed certificate for local HTTPS...");
  execSync(
    `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" ` +
      `-days 365 -nodes -subj "/CN=127.0.0.1" ` +
      `-addext "subjectAltName=IP:127.0.0.1"`,
    { stdio: "pipe" }
  );
  console.log("Certificate generated in certs/");

  return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
}

async function hasValidToken(): Promise<boolean> {
  if (!schwabAuth) return false;
  try {
    const token = await schwabAuth.getAccessToken();
    return !!token;
  } catch {
    return false;
  }
}

app.use(express.static(path.join(__dirname, "public")));

app.get("/auth/login", async (_req, res) => {
  if (!schwabAuth)
    return res.status(500).json({ error: "Auth not initialized" });
  const { authUrl } = await schwabAuth.getAuthorizationUrl();
  res.redirect(authUrl);
});

app.get("/auth/callback", async (req, res) => {
  try {
    const code = req.query.code as string;
    if (!code || !schwabAuth)
      return res.status(400).send("Missing authorization code");

    await schwabAuth.exchangeCode(code);
    res.redirect("/");
  } catch (error) {
    console.error("Auth callback error:", error);
    res.status(500).send("Authentication failed");
  }
});

app.get("/auth/status", async (_req, res) => {
  const authenticated = await hasValidToken();
  res.json({ authenticated });
});

const SCHWAB_API_BASE = "https://api.schwabapi.com/marketdata/v1";

function dateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function buildDateWindows(): { fromDate: string; toDate: string }[] {
  const windows: { fromDate: string; toDate: string }[] = [];
  const now = new Date();
  const cap = new Date();
  cap.setFullYear(cap.getFullYear() + 2);

  let cursor = new Date(now);
  while (cursor < cap) {
    const end = new Date(cursor);
    end.setMonth(end.getMonth() + 3);
    const windowEnd = end > cap ? cap : end;
    windows.push({ fromDate: dateStr(cursor), toDate: dateStr(windowEnd) });
    cursor = new Date(windowEnd);
    cursor.setDate(cursor.getDate() + 1);
  }
  return windows;
}

function mergeExpDateMap(target: Record<string, any>, source: Record<string, any>) {
  for (const [expKey, strikes] of Object.entries(source)) {
    if (!target[expKey]) {
      target[expKey] = strikes;
    } else {
      for (const [strikeKey, contracts] of Object.entries(strikes as Record<string, any>)) {
        if (!target[expKey][strikeKey]) {
          target[expKey][strikeKey] = contracts;
        } else {
          target[expKey][strikeKey] = [
            ...target[expKey][strikeKey],
            ...(contracts as any[]),
          ];
        }
      }
    }
  }
}

async function fetchOptionChainWindow(
  symbol: string,
  accessToken: string,
  fromDate: string,
  toDate: string
): Promise<any | null> {
  const params = new URLSearchParams({
    symbol,
    contractType: "ALL",
    includeUnderlyingQuote: "true",
    strategy: "SINGLE",
    range: "ALL",
    fromDate,
    toDate,
  });
  const resp = await fetch(`${SCHWAB_API_BASE}/chains?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) {
    console.error(
      `Schwab chains API returned ${resp.status} for ${fromDate}..${toDate}`
    );
    return null;
  }
  return resp.json();
}

async function fetchOptionChainAll(
  symbol: string,
  accessToken: string
): Promise<any> {
  const windows = buildDateWindows();
  const results = await Promise.all(
    windows.map((w) =>
      fetchOptionChainWindow(symbol, accessToken, w.fromDate, w.toDate)
    )
  );

  const merged: any = { callExpDateMap: {}, putExpDateMap: {} };
  for (const chunk of results) {
    if (!chunk) continue;
    if (!merged.underlying && chunk.underlying)
      merged.underlying = chunk.underlying;
    if (!merged.underlyingPrice && chunk.underlyingPrice)
      merged.underlyingPrice = chunk.underlyingPrice;
    if (chunk.callExpDateMap)
      mergeExpDateMap(merged.callExpDateMap, chunk.callExpDateMap);
    if (chunk.putExpDateMap)
      mergeExpDateMap(merged.putExpDateMap, chunk.putExpDateMap);
  }
  return merged;
}

async function fetchPriceHistoryRaw(
  symbol: string,
  accessToken: string,
  frequencyType: string,
  frequency: string,
  periodType: string,
  period: string
): Promise<any> {
  const params = new URLSearchParams({
    symbol,
    periodType,
    period,
    frequencyType,
    frequency,
  });
  const resp = await fetch(`${SCHWAB_API_BASE}/pricehistory?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) {
    throw new Error(`Schwab pricehistory API returned ${resp.status}`);
  }
  return resp.json();
}

app.get("/api/price/:symbol", async (req, res) => {
  if (!schwabAuth)
    return res.status(401).json({ error: "Not authenticated" });

  try {
    const accessToken = await schwabAuth.getAccessToken();
    if (!accessToken)
      return res.status(401).json({ error: "No valid access token" });

    const frequencyType = (req.query.frequencyType as string) || "daily";
    const frequency = (req.query.frequency as string) || "1";
    const periodType = (req.query.periodType as string) || "year";
    const period = (req.query.period as string) || "1";

    const priceHistory = await fetchPriceHistoryRaw(
      req.params.symbol,
      accessToken,
      frequencyType,
      frequency,
      periodType,
      period
    );
    res.json(priceHistory);
  } catch (error: any) {
    console.error("Price API error:", error?.message || error);
    res.status(500).json({ error: "Failed to fetch price data" });
  }
});

app.get("/api/gex/:symbol", async (req, res) => {
  if (!schwabAuth)
    return res.status(401).json({ error: "Not authenticated" });

  try {
    const accessToken = await schwabAuth.getAccessToken();
    if (!accessToken)
      return res.status(401).json({ error: "No valid access token" });

    const expParam = req.query.expirations as string | undefined;

    if (expParam) {
      const selectedExpirations = new Set(expParam.split(","));
      const optionChain = await fetchOptionChainAll(
        req.params.symbol,
        accessToken
      );
      const expirationDates = getExpirationDates(optionChain);
      const gexLevels = calculateGEX(optionChain, selectedExpirations);
      res.json({
        gexLevels,
        expirationDates,
        underlying: optionChain.underlying,
        underlyingPrice: optionChain.underlyingPrice,
      });
      return;
    }

    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Transfer-Encoding", "chunked");
    res.flushHeaders();

    const symbol = req.params.symbol;
    const windows = buildDateWindows();
    const allExpDates = new Set<string>();

    const fetches = windows.map((w) =>
      fetchOptionChainWindow(symbol, accessToken, w.fromDate, w.toDate)
    );

    // Await the first window (0-3mo) so we always send GEX data first
    const firstChunk = await fetches[0];
    if (firstChunk) {
      const chunkExpDates = getExpirationDates(firstChunk);
      for (const d of chunkExpDates) allExpDates.add(d);

      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() + 60);
      const cutoffStr = cutoff.toISOString().slice(0, 10);
      const within60 = chunkExpDates.filter((d) => d <= cutoffStr);
      const selected =
        within60.length > 0 ? new Set(within60) : undefined;
      const gexLevels = calculateGEX(firstChunk, selected);
      res.write(
        JSON.stringify({
          gexLevels,
          expirationDates: [...allExpDates].sort(),
          underlying: firstChunk.underlying,
          underlyingPrice: firstChunk.underlyingPrice,
        }) + "\n"
      );
    }

    // Remaining windows stream expiration dates as they arrive
    const rest = fetches.slice(1).map((p, i) =>
      p.then((chunk) => ({ idx: i + 1, chunk }))
    );
    const remaining = [...rest];
    while (remaining.length > 0) {
      const resolved = await Promise.race(remaining);
      remaining.splice(
        remaining.findIndex((p) => p === rest[resolved.idx - 1]),
        1
      );

      const { chunk } = resolved;
      if (!chunk) continue;

      const chunkExpDates = getExpirationDates(chunk);
      const newExpDates = chunkExpDates.filter((d) => !allExpDates.has(d));
      for (const d of newExpDates) allExpDates.add(d);

      if (newExpDates.length > 0) {
        res.write(
          JSON.stringify({
            expirationDates: [...allExpDates].sort(),
          }) + "\n"
        );
      }
    }

    res.write(JSON.stringify({ done: true }) + "\n");
    res.end();
  } catch (error: any) {
    console.error("GEX API error:", error?.message || error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to fetch GEX data" });
    } else {
      res.end();
    }
  }
});

const sslOpts = ensureCerts();
https.createServer(sslOpts, app).listen(PORT, () => {
  console.log(`GEX Dash running at https://127.0.0.1:${PORT}`);
  console.log(`Authenticate at https://127.0.0.1:${PORT}/auth/login`);
});
