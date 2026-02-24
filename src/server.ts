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
const PORT = process.env.PORT || 3000;
const REDIRECT_URI = `https://127.0.0.1:${PORT}/auth/callback`;

const schwabAuth = initSchwabAuth(REDIRECT_URI, projectRoot);
const app = express();

app.use(express.static(path.join(__dirname, "public")));

registerAuthRoutes(app, () => schwabAuth);
registerStreamRoutes(app, () => schwabAuth);
registerWatchlistRoutes(app, projectRoot);

const sslOpts = ensureCerts(projectRoot);
https.createServer(sslOpts, app).listen(PORT, () => {
  console.log(`GEX Dash running at https://127.0.0.1:${PORT}`);
  console.log(`Authenticate at https://127.0.0.1:${PORT}/auth/login`);
});
