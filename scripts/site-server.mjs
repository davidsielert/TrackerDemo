import http from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { join, normalize, resolve } from "node:path";

const port = Number(process.env.SITES_PORT ?? 8080);
const root = resolve("sites");
const siteFolders = new Map([
  ["demo.localhost", "demo"],
  ["news.localhost", "news"],
  ["weather.localhost", "weather"],
  ["shop.localhost", "shop"],
  ["lead-form.localhost", "lead-form"]
]);

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml"
};

const server = http.createServer((req, res) => {
  const hostname = (req.headers.host ?? "").split(":")[0];
  const folder = siteFolders.get(hostname);

  if (!folder) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Use demo.localhost, news.localhost, weather.localhost, shop.localhost, or lead-form.localhost.");
    return;
  }

  const url = new URL(req.url ?? "/", `http://${hostname}`);
  const filePath = resolvePath(folder, url.pathname);

  if (!filePath || !existsSync(filePath)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  res.writeHead(200, { "Content-Type": contentTypes[extension(filePath)] ?? "application/octet-stream" });
  createReadStream(filePath).pipe(res);
});

server.listen(port, () => {
  console.log(`demo sites listening on http://demo.localhost:${port}, http://news.localhost:${port}, http://weather.localhost:${port}, http://shop.localhost:${port}, and http://lead-form.localhost:${port}`);
});

function resolvePath(folder, pathname) {
  if (pathname === "/shared.css") return join(root, "shared.css");
  if (pathname.startsWith("/assets/")) return safeJoin(root, pathname);
  if (pathname === "/" || pathname === "/index.html") return join(root, folder, "index.html");
  return safeJoin(join(root, folder), pathname);
}

function safeJoin(base, pathname) {
  const target = normalize(join(base, pathname));
  return target.startsWith(base) ? target : null;
}

function extension(filePath) {
  const dot = filePath.lastIndexOf(".");
  return dot === -1 ? "" : filePath.slice(dot);
}
