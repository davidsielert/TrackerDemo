import { spawn } from "node:child_process";

const processes = [
  {
    name: "tracker",
    command: "npm",
    args: ["--workspace", "tracker", "run", "dev"],
    env: { PORT: "4000", DB_PATH: "./tracker/data/tracker-demo.sqlite" }
  },
  {
    name: "dashboard",
    command: "npm",
    args: ["--workspace", "dashboard", "run", "dev", "--", "--host", "0.0.0.0"],
    env: {}
  },
  {
    name: "sites",
    command: "npm",
    args: ["run", "sites:local"],
    env: {}
  }
];

let shuttingDown = false;

const children = processes.map((proc) => {
  const child = spawn(proc.command, proc.args, {
    stdio: "pipe",
    env: { ...process.env, ...proc.env }
  });

  child.stdout.on("data", (chunk) => prefix(proc.name, chunk));
  child.stderr.on("data", (chunk) => prefix(proc.name, chunk));
  child.on("exit", (code) => {
    if (code && !shuttingDown) {
      console.error(`[${proc.name}] exited with code ${code}`);
      shutdown(code);
    }
  });

  return child;
});

console.log(`
Local privacy training demo is starting.

Open:
  Dashboard  http://dashboard.localhost:5173
  Demo Hub   http://demo.localhost:8080
  News       http://news.localhost:8080
  Weather    http://weather.localhost:8080
  Shop       http://shop.localhost:8080
  Lead Form  http://lead-form.localhost:8080
  Tracker    http://tracker.localhost:4000/health

Press Ctrl+C to stop all services.
`);

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

function prefix(name, chunk) {
  for (const line of chunk.toString().split(/\r?\n/)) {
    if (line.trim()) console.log(`[${name}] ${line}`);
  }
}

function shutdown(code) {
  shuttingDown = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 300);
}
