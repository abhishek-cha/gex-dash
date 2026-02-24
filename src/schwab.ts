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

function dateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function buildDateWindows(): { fromDate: string; toDate: string }[] {
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

// --- Option chain merging ---

function mergeExpDateMap(
  target: Record<string, any>,
  source: Record<string, any>
) {
  for (const [expKey, strikes] of Object.entries(source)) {
    if (!target[expKey]) {
      target[expKey] = strikes;
    } else {
      for (const [strikeKey, contracts] of Object.entries(
        strikes as Record<string, any>
      )) {
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

export async function fetchOptionChainAll(
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
