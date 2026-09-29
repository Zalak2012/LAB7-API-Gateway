require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.GATEWAY_PORT || process.env.PORT || 3000;

// ── Part B: Configuration-Based Service Discovery ───────────────────────────
// Load the service registry from the JSON config file.
// Environment variables can override the config file values.
const registryPath = path.join(__dirname, "service-registry.json");
let serviceRegistry = {};

try {
  const rawConfig = fs.readFileSync(registryPath, "utf-8");
  const config = JSON.parse(rawConfig);
  serviceRegistry = config.services || {};
  console.log(`[API Gateway] Loaded service registry from ${registryPath}`);
} catch (err) {
  console.warn(`[API Gateway] Could not load service-registry.json: ${err.message}. Falling back to env vars only.`);
}

// Environment variables take priority over the config file
const USER_SERVICE_URL =
  process.env.USER_SERVICE_URL ||
  (serviceRegistry["user-service"] && serviceRegistry["user-service"].url) ||
  "http://user-service:3001";

const PRODUCT_SERVICE_URL =
  process.env.PRODUCT_SERVICE_URL ||
  (serviceRegistry["product-service"] && serviceRegistry["product-service"].url) ||
  "http://product-service:3002";

const ORDER_SERVICE_URL =
  process.env.ORDER_SERVICE_URL ||
  (serviceRegistry["order-service"] && serviceRegistry["order-service"].url) ||
  "http://order-service:3003";

// Build the routing table from config (no hard-coded routes in application code)
const routingTable = {
  "/users": USER_SERVICE_URL,
  "/products": PRODUCT_SERVICE_URL,
  "/orders": ORDER_SERVICE_URL
};

app.use(cors());
app.use(express.json());

// ── Request Logging Middleware ───────────────────────────────────────────────
// Logs every incoming request: method, path, target service, and response status
app.use((req, res, next) => {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();

  // Determine which backend service this request maps to
  let targetService = "none (gateway-local)";
  for (const [prefix, url] of Object.entries(routingTable)) {
    if (req.originalUrl.startsWith(prefix)) {
      targetService = url;
      break;
    }
  }

  // Log when the response finishes
  res.on("finish", () => {
    const duration = Date.now() - startTime;
    console.log(
      `[API Gateway] ${timestamp} | ${req.method} ${req.originalUrl} → ${targetService} | Status: ${res.statusCode} | ${duration}ms`
    );
  });

  next();
});

// ── Proxy Helper with Error Handling ────────────────────────────────────────
async function proxyRequest(targetBaseUrl, req, res) {
  const targetUrl = `${targetBaseUrl}${req.originalUrl}`;

  const options = {
    method: req.method,
    headers: {
      "Content-Type": "application/json"
    }
  };

  if (["POST", "PUT", "PATCH"].includes(req.method) && Object.keys(req.body || {}).length > 0) {
    options.body = JSON.stringify(req.body);
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 sec timeout

    const response = await fetch(targetUrl, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);

    const contentType = response.headers.get("content-type");
    let data;
    if (contentType && contentType.includes("application/json")) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    res.status(response.status).send(data);
  } catch (error) {
    // Centralized error handling: return clean 502/503 instead of hanging/crashing
    const statusCode = error.name === "AbortError" ? 504 : 502;
    const errorType = error.name === "AbortError" ? "Gateway Timeout" : "Bad Gateway";

    console.error(
      `[API Gateway] ERROR proxying ${req.method} ${req.originalUrl} → ${targetUrl}: ${error.message}`
    );

    res.status(statusCode).json({
      status: statusCode,
      error: errorType,
      message: `The target service at ${targetBaseUrl} is unreachable. (${error.message})`,
      path: req.originalUrl,
      timestamp: new Date().toISOString()
    });
  }
}

// ── Health Check Endpoint ───────────────────────────────────────────────────
// Returns gateway status and the current routing table — no proxying involved
app.get("/health", (req, res) => {
  res.status(200).json({
    service: "api-gateway",
    status: "UP",
    timestamp: new Date().toISOString(),
    routes: routingTable
  });
});

// ── Reverse-Proxy Route Handlers ────────────────────────────────────────────
app.use("/users*", (req, res) => proxyRequest(USER_SERVICE_URL, req, res));
app.use("/products*", (req, res) => proxyRequest(PRODUCT_SERVICE_URL, req, res));
app.use("/orders*", (req, res) => proxyRequest(ORDER_SERVICE_URL, req, res));

// ── 404 Catch-All ───────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    status: 404,
    error: "Not Found",
    message: `API Gateway: route ${req.method} ${req.originalUrl} is not recognized. Available prefixes: /users, /products, /orders`,
    timestamp: new Date().toISOString()
  });
});

// ── Start Server ────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n[API Gateway] ✔ Running on port ${PORT}`);
  console.log(`[API Gateway] Routing table (from config + env overrides):`);
  for (const [prefix, url] of Object.entries(routingTable)) {
    console.log(`  ${prefix}  →  ${url}`);
  }
  console.log("");
});
