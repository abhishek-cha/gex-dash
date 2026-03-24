import express from "express";
import https from "https";
import path from "path";
import { fileURLToPath } from "url";
import { ensureCerts } from "./certs.js";
import { initSchwabAuth } from "./schwab.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerStreamRoutes } from "./routes/stream.js";
import { registerWatchlistRoutes } from "./routes/watchlist.js";
import "dotenv/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const dataDir = process.env.DATA_DIR || projectRoot;
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "127.0.0.1";
const REDIRECT_URI = `https://${HOST}:${PORT}/auth/callback`;

const schwabAuth = initSchwabAuth(REDIRECT_URI, dataDir);
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

registerAuthRoutes(app, () => schwabAuth);
registerStreamRoutes(app, () => schwabAuth);
registerWatchlistRoutes(app, dataDir);

const sslOpts = ensureCerts(dataDir);
https.createServer(sslOpts, app).listen(PORT, () => {
  console.log(`GEX Dash running at https://${HOST}:${PORT}`);
  console.log(`Authenticate at https://${HOST}:${PORT}/auth/login`);
});
