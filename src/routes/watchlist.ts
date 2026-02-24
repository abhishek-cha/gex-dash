import type { Express } from "express";
import fs from "fs";
import path from "path";

export function registerWatchlistRoutes(app: Express, projectRoot: string) {
  const filePath = path.join(projectRoot, "watchlist.json");

  function read(): string[] {
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch {
      return [];
    }
  }

  function write(list: string[]) {
    fs.writeFileSync(filePath, JSON.stringify(list, null, 2));
  }

  app.get("/api/watchlist", (_req, res) => {
    res.json(read());
  });

  app.post("/api/watchlist/:symbol", (req, res) => {
    const symbol = req.params.symbol.toUpperCase();
    const list = read();
    if (!list.includes(symbol)) {
      list.push(symbol);
      write(list);
    }
    res.json(list);
  });

  app.delete("/api/watchlist/:symbol", (req, res) => {
    const symbol = req.params.symbol.toUpperCase();
    const list = read().filter((s) => s !== symbol);
    write(list);
    res.json(list);
  });
}
