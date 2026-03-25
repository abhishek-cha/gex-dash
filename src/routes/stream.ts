import type { Express, Request, Response } from "express";
import type { EnhancedTokenManager } from "@sudowealth/schwab-api";
import {
  buildDateWindows,
  fetchExpirations,
  fetchOptionChainWindow,
  fetchPriceHistory,
  fetchQuote,
  estToday,
  getValidAccessToken,
} from "../schwab.js";
import { calculateGEX, getExpirationDates } from "../gex.js";

function sendEvent(res: Response, type: string, data: unknown) {
  res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function streamPrice(
  req: Request,
  res: Response,
  symbol: string,
  accessToken: string,
  aborted: () => boolean
) {
  const frequencyType = (req.query.frequencyType as string) || "daily";
  const frequency = (req.query.frequency as string) || "1";
  const periodType = (req.query.periodType as string) || "year";
  const period = (req.query.period as string) || "1";

  const priceHistory = await fetchPriceHistory(
    symbol,
    accessToken,
    frequencyType,
    frequency,
    periodType,
    period
  );
  if (!aborted()) sendEvent(res, "price", priceHistory);
}

async function streamQuote(
  res: Response,
  symbol: string,
  accessToken: string,
  aborted: () => boolean
) {
  const quote = await fetchQuote(symbol, accessToken);
  if (!aborted()) {
    sendEvent(res, "quote", {
      price: quote.lastPrice ?? quote.mark ?? 0,
      change: quote.netChange ?? 0,
      percentChange: quote.netPercentChange ?? 0,
    });
  }
}

async function streamExpirations(
  res: Response,
  symbol: string,
  accessToken: string,
  aborted: () => boolean
) {
  const list = await fetchExpirations(symbol, accessToken);
  if (aborted()) return;

  const expirationDates = list.map((e) => e.expirationDate).sort();
  sendEvent(res, "expirations", { expirationDates });
}

async function streamGEX(
  res: Response,
  symbol: string,
  accessToken: string,
  expirations: string | undefined,
  aborted: () => boolean
) {
  const selectedFilter = expirations
    ? new Set(expirations.split(","))
    : undefined;

  // 60-day cutoff for default selection
  const cutoff = estToday();
  cutoff.setUTCDate(cutoff.getUTCDate() + 60);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  // Only fetch windows that overlap with needed dates
  const allWindows = buildDateWindows();
  const windows = selectedFilter
    ? allWindows.filter((w) =>
        [...selectedFilter].some((d) => d >= w.fromDate && d <= w.toDate)
      )
    : allWindows.filter((w) => w.fromDate <= cutoffStr);

  const fetches = windows.map((p, i) =>
    fetchOptionChainWindow(symbol, accessToken, p.fromDate, p.toDate).then(
      (chunk) => ({ idx: i, chunk })
    )
  );
  const remaining = [...fetches];

  while (remaining.length > 0) {
    const resolved = await Promise.race(remaining);
    if (aborted()) return;

    remaining.splice(remaining.indexOf(fetches[resolved.idx]), 1);

    const { chunk } = resolved;
    if (!chunk) continue;

    const chunkExpDates = getExpirationDates(chunk);

    // Filter: explicit filter or 60-day default
    const chunkFilter = selectedFilter
      ?? new Set(chunkExpDates.filter((d) => d <= cutoffStr));

    const gexLevels = calculateGEX(chunk, chunkFilter);
    const chunkSelected = chunkExpDates.filter((d) => chunkFilter.has(d));

    if (gexLevels.length > 0) {
      sendEvent(res, "gex", { gexLevels, selectedExpirations: chunkSelected });
    }
  }
}

export function registerStreamRoutes(
  app: Express,
  getSchwabAuth: () => EnhancedTokenManager
) {
  app.get("/api/stream/:symbol", async (req, res) => {
    const schwabAuth = getSchwabAuth();

    try {
      const accessToken = await getValidAccessToken(schwabAuth);
      if (!accessToken) {
        return res.status(401).json({ error: "No valid access token" });
      }

      const typesParam = (req.query.types as string) || "";
      const types = new Set(typesParam.split(",").filter(Boolean));
      if (types.size === 0) {
        return res.status(400).json({ error: "Missing types parameter" });
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();

      let closed = false;
      req.on("close", () => {
        closed = true;
      });
      const aborted = () => closed;

      const symbol = req.params.symbol;
      const expirations = req.query.expirations as string | undefined;
      const tasks: Promise<void>[] = [];

      if (types.has("price")) {
        tasks.push(
          streamPrice(req, res, symbol, accessToken, aborted)
            .then(() => { if (!aborted()) sendEvent(res, "done", { type: "price" }); })
            .catch((err) => {
              console.error("Price stream error:", err?.message || err);
              if (!aborted()) sendEvent(res, "error", { type: "price", error: "Failed to fetch price data" });
            })
        );
      }

      if (types.has("quote")) {
        tasks.push(
          streamQuote(res, symbol, accessToken, aborted)
            .then(() => { if (!aborted()) sendEvent(res, "done", { type: "quote" }); })
            .catch((err) => {
              console.error("Quote stream error:", err?.message || err);
              if (!aborted()) sendEvent(res, "error", { type: "quote", error: "Failed to fetch quote" });
            })
        );
      }

      if (types.has("gex")) {
        tasks.push(
          streamGEX(res, symbol, accessToken, expirations, aborted)
            .then(() => { if (!aborted()) sendEvent(res, "done", { type: "gex" }); })
            .catch(
            (err) => {
              console.error("GEX stream error:", err?.message || err);
              if (!aborted()) sendEvent(res, "error", { type: "gex", error: "Failed to fetch GEX data" });
            })
        );
      }

      if (types.has("expiration")) {
        tasks.push(
          streamExpirations(res, symbol, accessToken, aborted)
            .then(() => { if (!aborted()) sendEvent(res, "done", { type: "expiration" }); })
            .catch((err) => {
              console.error("Expiration stream error:", err?.message || err);
              if (!aborted()) sendEvent(res, "error", { type: "expiration", error: "Failed to fetch expirations" });
            })
        );
      }

      await Promise.all(tasks);
      if (!closed) {
        sendEvent(res, "done", {});
        res.end();
      }
    } catch (error: any) {
      console.error("Stream API error:", error?.message || error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Stream failed" });
      } else {
        res.end();
      }
    }
  });
}
