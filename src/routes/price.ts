import type { Express } from "express";
import type { EnhancedTokenManager } from "@sudowealth/schwab-api";
import { fetchPriceHistory } from "../schwab.js";

export function registerPriceRoutes(
  app: Express,
  getSchwabAuth: () => EnhancedTokenManager
) {
  app.get("/api/price/:symbol", async (req, res) => {
    const schwabAuth = getSchwabAuth();

    try {
      const accessToken = await schwabAuth.getAccessToken();
      if (!accessToken)
        return res.status(401).json({ error: "No valid access token" });

      const frequencyType = (req.query.frequencyType as string) || "daily";
      const frequency = (req.query.frequency as string) || "1";
      const periodType = (req.query.periodType as string) || "year";
      const period = (req.query.period as string) || "1";

      const priceHistory = await fetchPriceHistory(
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
}
