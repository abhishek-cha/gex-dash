import fs from "fs";
import path from "path";
import {
  createSchwabAuth,
  type EnhancedTokenManager,
} from "@sudowealth/schwab-api";

const SCHWAB_API_BASE = "https://api.schwabapi.com/marketdata/v1";

// --- Token persistence ---

function saveTokens(tokenFile: string, tokens: any) {
  fs.writeFileSync(tokenFile, JSON.stringify(tokens, null, 2));
}

function loadTokens(tokenFile: string): any | null {
  if (!fs.existsSync(tokenFile)) return null;
  try {
    return JSON.parse(fs.readFileSync(tokenFile, "utf-8"));
  } catch {
    return null;
  }
}

// --- Auth setup ---

export function initSchwabAuth(
  redirectUri: string,
  projectRoot: string
): EnhancedTokenManager {
  const tokenFile = path.join(projectRoot, ".tokens.json");
  return createSchwabAuth({
    oauthConfig: {
      clientId: process.env.SCHWAB_CLIENT_ID!,
      clientSecret: process.env.SCHWAB_CLIENT_SECRET!,
      redirectUri,
      save: async (tokens) => {
        saveTokens(tokenFile, tokens);
        console.log("Tokens saved to .tokens.json");
      },
      load: async () => {
        const tokens = loadTokens(tokenFile);
        if (tokens) console.log("Tokens loaded from .tokens.json");
        return tokens;
      },
    },
  });
}

export async function hasValidToken(
  auth: EnhancedTokenManager
): Promise<boolean> {
  try {
    const token = await auth.getAccessToken();
    return !!token;
  } catch {
    return false;
  }
}

// --- Date windowing for option chains ---

/** Today's date in US Eastern Time (options market timezone). */
export function estToday(): Date {
  const parts = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }).split("-");
  return new Date(Date.UTC(+parts[0], +parts[1] - 1, +parts[2]));
}

function dateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function buildDateWindows(
  intervalDays = 14
): { fromDate: string; toDate: string }[] {
  const windows: { fromDate: string; toDate: string }[] = [];
  const now = estToday();
  const cap = new Date(Date.UTC(now.getUTCFullYear() + 2, now.getUTCMonth(), now.getUTCDate()));

  let cursor = new Date(now);
  while (cursor < cap) {
    const end = new Date(cursor);
    end.setUTCDate(end.getUTCDate() + intervalDays);
    const windowEnd = end > cap ? cap : end;
    windows.push({ fromDate: dateStr(cursor), toDate: dateStr(windowEnd) });
    cursor = new Date(windowEnd);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return windows;
}

// --- Schwab API fetch functions ---

export async function fetchOptionChainWindow(
  symbol: string,
  accessToken: string,
  fromDate: string,
  toDate: string
): Promise<any | null> {
  const params = new URLSearchParams({
    symbol,
    contractType: "ALL",
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

export async function fetchQuote(
  symbol: string,
  accessToken: string
): Promise<any> {
  const resp = await fetch(
    `${SCHWAB_API_BASE}/${encodeURIComponent(symbol)}/quotes`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!resp.ok) {
    throw new Error(`Schwab quotes API returned ${resp.status}`);
  }
  const data = await resp.json();
  return data[symbol]?.quote || data[symbol] || {};
}

export async function fetchExpirations(
  symbol: string,
  accessToken: string
): Promise<{ expirationDate: string; daysToExpiration: number; expirationType: string; standard: boolean }[]> {
  const now = estToday();
  const cap = new Date(Date.UTC(now.getUTCFullYear() + 2, now.getUTCMonth(), now.getUTCDate()));
  const params = new URLSearchParams({ symbol });
  const resp = await fetch(`${SCHWAB_API_BASE}/expirationchain?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) {
    throw new Error(`Schwab expirationchain API returned ${resp.status}`);
  }
  const data = await resp.json();
  return (data.expirationList || []).filter(
    (e: any) => new Date(e.expirationDate) >= now && new Date(e.expirationDate) <= cap
  );
}

export async function fetchPriceHistory(
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
    endDate: Date.now().toString(),
    needExtendedHoursData: "true",
  });
  const resp = await fetch(`${SCHWAB_API_BASE}/pricehistory?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) {
    throw new Error(`Schwab pricehistory API returned ${resp.status}`);
  }
  return resp.json();
}
