import type { Express } from "express";
import type { EnhancedTokenManager } from "@sudowealth/schwab-api";
import {
  buildDateWindows,
  fetchOptionChainAll,
  fetchOptionChainWindow,
} from "../schwab.js";
import { calculateGEX, getExpirationDates } from "../gex.js";

export function registerGexRoutes(
  app: Express,
  getSchwabAuth: () => EnhancedTokenManager
) {
  app.get("/api/gex/:symbol", async (req, res) => {
    const schwabAuth = getSchwabAuth();

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
}
