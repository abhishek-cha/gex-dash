import type { Express } from "express";
import type { EnhancedTokenManager } from "@sudowealth/schwab-api";
import { hasValidToken } from "../schwab.js";

export function registerAuthRoutes(
  app: Express,
  getSchwabAuth: () => EnhancedTokenManager
) {
  app.get("/auth/login", async (_req, res) => {
    const schwabAuth = getSchwabAuth();
    const { authUrl } = await schwabAuth.getAuthorizationUrl();
    res.redirect(authUrl);
  });

  app.get("/auth/callback", async (req, res) => {
    try {
      const code = req.query.code as string;
      if (!code)
        return res.status(400).send("Missing authorization code");

      const schwabAuth = getSchwabAuth();
      await schwabAuth.exchangeCode(code);
      res.redirect("/");
    } catch (error) {
      console.error("Auth callback error:", error);
      res.status(500).send("Authentication failed");
    }
  });

  app.get("/auth/status", async (_req, res) => {
    const authenticated = await hasValidToken(getSchwabAuth());
    res.json({ authenticated });
  });
}
