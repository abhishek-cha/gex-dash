import type { Express, Request, Response } from "express";
import type { EnhancedTokenManager } from "@sudowealth/schwab-api";
import {
  buildDateWindows,
  fetchOptionChainAll,
  fetchOptionChainWindow,
  fetchPriceHistory,
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

async function streamGEX(
  res: Response,
  symbol: string,
  accessToken: string,
  expirations: string | undefined,
  aborted: () => boolean
) {
  if (expirations) {
    const selectedExpirations = new Set(expirations.split(","));
    const optionChain = await fetchOptionChainAll(symbol, accessToken);
    if (aborted()) return;
    const expirationDates = getExpirationDates(optionChain);
    const gexLevels = calculateGEX(optionChain, selectedExpirations);
    sendEvent(res, "expirations", { expirationDates });
    sendEvent(res, "gex", {
      gexLevels,
      selectedExpirations: [...selectedExpirations],
      underlying: optionChain.underlying,
      underlyingPrice: optionChain.underlyingPrice,
    });
    return;
  }

  const windows = buildDateWindows();
  const allExpDates = new Set<string>();

  const fetches = windows.map((w) =>
    fetchOptionChainWindow(symbol, accessToken, w.fromDate, w.toDate)
  );

  const firstChunk = await fetches[0];
  if (aborted()) return;

  if (firstChunk) {
    const chunkExpDates = getExpirationDates(firstChunk);
    for (const d of chunkExpDates) allExpDates.add(d);

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + 60);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    const within60 = chunkExpDates.filter((d) => d <= cutoffStr);
    const selected = within60.length > 0 ? new Set(within60) : undefined;
    const gexLevels = calculateGEX(firstChunk, selected);
    sendEvent(res, "expirations", {
      expirationDates: [...allExpDates].sort(),
    });
    sendEvent(res, "gex", {
      gexLevels,
      selectedExpirations: selected ? [...selected] : [...allExpDates].sort(),
      underlying: firstChunk.underlying,
      underlyingPrice: firstChunk.underlyingPrice,
    });
  }

  const rest = fetches
    .slice(1)
    .map((p, i) => p.then((chunk) => ({ idx: i + 1, chunk })));
  const remaining = [...rest];

  while (remaining.length > 0) {
    const resolved = await Promise.race(remaining);
    if (aborted()) return;

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
      sendEvent(res, "expirations", {
        expirationDates: [...allExpDates].sort(),
      });
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
      const accessToken = await schwabAuth.getAccessToken();
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
          streamPrice(req, res, symbol, accessToken, aborted).catch((err) => {
            console.error("Price stream error:", err?.message || err);
            if (!aborted()) sendEvent(res, "error", { type: "price", error: "Failed to fetch price data" });
          })
        );
      }

      if (types.has("gex")) {
        tasks.push(
          streamGEX(res, symbol, accessToken, expirations, aborted).catch(
            (err) => {
              console.error("GEX stream error:", err?.message || err);
              if (!aborted()) sendEvent(res, "error", { type: "gex", error: "Failed to fetch GEX data" });
            }
          )
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
