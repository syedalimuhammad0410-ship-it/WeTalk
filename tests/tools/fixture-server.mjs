// Serves fixture websites for audit tests: http://127.0.0.1:PORT/<site>/...
// Each site is exposed on its own host port so robots.txt applies per site.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/sites");
export function startFixtureServer(site, port = 0) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent((req.url || "/").split("?")[0]);
      if (p === "/") p = "/index.html";
      let file = path.join(root, site, p);
      if (!fs.existsSync(file) && fs.existsSync(`${file}.html`)) file = `${file}.html`;
      if (!file.startsWith(path.join(root, site)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404, { "content-type": "text/html" }); return res.end("<h1>Not found</h1>"); }
      const type = file.endsWith(".txt") ? "text/plain" : "text/html; charset=utf-8";
      res.writeHead(200, { "content-type": type });
      if (req.method === "HEAD") return res.end();
      res.end(fs.readFileSync(file));
    });
    server.listen(port, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [site = "outdated", port = "4010"] = process.argv.slice(2);
  startFixtureServer(site, +port).then(({ url }) => console.log(`${site} at ${url}`));
}
