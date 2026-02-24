import fs from "fs";
import path from "path";
import { execSync } from "child_process";

export function ensureCerts(projectRoot: string): {
  key: Buffer;
  cert: Buffer;
} {
  const certDir = path.join(projectRoot, "certs");
  const keyPath = path.join(certDir, "key.pem");
  const certPath = path.join(certDir, "cert.pem");

  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
  }

  fs.mkdirSync(certDir, { recursive: true });
  console.log("Generating self-signed certificate for local HTTPS...");
  execSync(
    `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" ` +
      `-days 365 -nodes -subj "/CN=127.0.0.1" ` +
      `-addext "subjectAltName=IP:127.0.0.1"`,
    { stdio: "pipe" }
  );
  console.log("Certificate generated in certs/");

  return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
}
