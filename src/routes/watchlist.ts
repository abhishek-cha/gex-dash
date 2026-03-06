import type { Express } from "express";
import fs from "fs";
import path from "path";

interface WatchlistSection {
  name: string;
  symbols: string[];
}

export function registerWatchlistRoutes(app: Express, projectRoot: string) {
  const filePath = path.join(projectRoot, "watchlist.json");

  function read(): WatchlistSection[] {
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      // Migrate flat array to sections format
      if (Array.isArray(raw) && (raw.length === 0 || typeof raw[0] === "string")) {
        const migrated: WatchlistSection[] =
          raw.length > 0 ? [{ name: "Watchlist", symbols: raw }] : [];
        write(migrated);
        return migrated;
      }
      return raw as WatchlistSection[];
    } catch {
      return [];
    }
  }

  function write(sections: WatchlistSection[]) {
    fs.writeFileSync(filePath, JSON.stringify(sections, null, 2));
  }

  // Get full watchlist
  app.get("/api/watchlist", (_req, res) => {
    res.json(read());
  });

  // Replace entire watchlist (reorder, rename sections, etc.)
  app.put("/api/watchlist", (req, res) => {
    const sections = req.body as WatchlistSection[];
    if (!Array.isArray(sections)) {
      return res.status(400).json({ error: "Expected array of sections" });
    }
    write(sections);
    res.json(sections);
  });

  // Add symbol to a section (creates section if needed)
  app.post("/api/watchlist/:section/:symbol", (req, res) => {
    const sectionName = req.params.section;
    const symbol = req.params.symbol.toUpperCase();
    const sections = read();
    let section = sections.find((s) => s.name === sectionName);
    if (!section) {
      section = { name: sectionName, symbols: [] };
      sections.push(section);
    }
    if (!section.symbols.includes(symbol)) {
      section.symbols.push(symbol);
    }
    write(sections);
    res.json(sections);
  });

  // Remove symbol from a section
  app.delete("/api/watchlist/:section/:symbol", (req, res) => {
    const sectionName = req.params.section;
    const symbol = req.params.symbol.toUpperCase();
    const sections = read();
    const section = sections.find((s) => s.name === sectionName);
    if (section) {
      section.symbols = section.symbols.filter((s) => s !== symbol);
      // Remove empty sections
      const filtered = sections.filter((s) => s.symbols.length > 0);
      write(filtered);
      res.json(filtered);
    } else {
      res.json(sections);
    }
  });
}
