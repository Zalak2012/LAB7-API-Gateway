# LAB 7 — API Gateway, Service Discovery & Cloud Deployment

**Course:** Web Services & SOA Laboratory  
**Topic:** Gateway · Service Discovery · Cloud  
**Student:** Zalak Thakkar

---

## 1. Objective

This lab extends the Lab 6 microservices architecture by:

1. **Building a real API Gateway** — a single, externally reachable entry point that proxies all client requests to the correct backend microservice.
2. **Implementing configuration-based service discovery** — the gateway reads service URLs from a config file (`service-registry.json`) and environment variables instead of hard-coding them.
3. **Deploying the containerized system to the cloud** — deploying the gateway and all three microservices as Docker containers on a cloud platform (Render / Railway / Fly.io), reachable over the internet.

---

## 2. Architecture Diagram

```
┌──────────────────────────────────────────────────────────────┐
│                        INTERNET                              │
│                                                              │
│  Client / Postman ──────────▶ API Gateway (public, cloud)    │
│                               Port 3000  (only exposed port) │
└──────────────────────────────┬───────────────────────────────┘
                               │
              ┌────────────────┼────────────────┐
              │   Docker Network (campus-net)   │
              │                                 │
              │  ┌──────────────────────────┐   │
              │  │  Service Registry /      │   │
              │  │  Config (.json + env)    │   │
              │  └──────────┬───────────────┘   │
              │             │                   │
              │   ┌─────────┼─────────┐         │
              │   │         │         │         │
              │   ▼         ▼         ▼         │
              │ ┌─────┐ ┌───────┐ ┌───────┐    │
              │ │User │ │Product│ │Order  │    │
              │ │Svc  │ │Svc    │ │Svc    │    │
              │ │:3001│ │:3002  │ │:3003  │    │
              │ └──┬──┘ └──┬────┘ └──┬────┘    │
              │    │       │         │          │
              └────┼───────┼─────────┼──────────┘
                   │       │         │
                   ▼       ▼         ▼
              ┌──────────────────────────┐
              │   MongoDB Atlas (Cloud)  │
              │   (connection strings)   │
              └──────────────────────────┘
```

| Layer | Responsibility | Reachable From |
|---|---|---|
| Client / Postman | Sends requests to one public address | Internet |
| API Gateway | Routes /users, /products, /orders; logging; error handling | Internet (public) |
| User / Product / Order Services | Own business logic and own data | Docker network only |
| MongoDB Atlas | Persistent storage per service | Services (via connection strings) |

---

## 3. Part A — Build a Real API Gateway

### What was built

The API Gateway in `api-gateway/server.js` is an Express application that:

- **Reverse-proxies** incoming requests to the correct backend microservice based on URL prefix:
  - `/users*` → User Service (`http://user-service:3001`)
  - `/products*` → Product Service (`http://product-service:3002`)
  - `/orders*` → Order Service (`http://order-service:3003`)

- **Request logging middleware** logs every request with:
  - ISO timestamp
  - HTTP method and path
  - Target service URL
  - Response status code
  - Duration in milliseconds
  
  Example log output:
  ```
  [API Gateway] 2026-09-29T04:00:00.000Z | GET /users → http://user-service:3001 | Status: 200 | 45ms
  ```

- **Health check endpoint** `GET /health` responds with the gateway's status and current routing table (no proxying involved).

- **Centralized error handling**:
  - If a target service is unreachable → **502 Bad Gateway** with a clear JSON error message
  - If the request times out (5 seconds) → **504 Gateway Timeout**
  - If an unknown route is hit → **404 Not Found** listing available prefixes

- **Only the gateway's port (3000) is exposed** in Docker Compose. User, Product, and Order services are reachable only from within the Docker bridge network.

### Gateway Endpoints

| Gateway Path | Routed To | Example |
|---|---|---|
| `GET /users`, `/users/{id}` | User Service | `GET /users/101` |
| `POST /users`, `PUT /users/{id}`, `DELETE /users/{id}` | User Service | `POST /users` |
| `GET /products`, `/products/{id}` | Product Service | `GET /products/501` |
| `POST /products`, `PUT /products/{id}`, `DELETE /products/{id}` | Product Service | `POST /products` |
| `POST /orders`, `GET /orders`, `GET /orders/{id}` | Order Service | `POST /orders` |
| `GET /health` | Gateway itself | Health check, no proxying |

---

## 4. Part B — Service Discovery (Configuration-Based)

### Approach

The gateway does **not** hard-code service locations inside route-handling code. Instead, service URLs are externalized into two layers:

1. **`service-registry.json`** — a static JSON config file that the gateway reads at startup:
   ```json
   {
     "services": {
       "user-service": {
         "url": "http://user-service:3001",
         "pathPrefix": "/users"
       },
       "product-service": {
         "url": "http://product-service:3002",
         "pathPrefix": "/products"
       },
       "order-service": {
         "url": "http://order-service:3003",
         "pathPrefix": "/orders"
       }
     }
   }
   ```

2. **Environment variables** (`USER_SERVICE_URL`, `PRODUCT_SERVICE_URL`, `ORDER_SERVICE_URL`) — these **override** the config file, making it easy to change service locations for cloud deployment without touching any code.

### Proving it works

To change a service's URL/port, you only need to:
1. Edit `service-registry.json`, **or**
2. Set the corresponding environment variable in `.env` or `compose.yaml`

No application code changes required — restart the gateway and routes point to the new location.

### Static vs. Dynamic Service Discovery

**This lab implements static/configuration-based service discovery** — service URLs are set at deploy time and read at startup.

**Dynamic service discovery** (e.g., Consul, Eureka, Kubernetes DNS) would allow services to:
- **Register themselves** at startup and **deregister** on shutdown
- **Discover peers** at runtime without any static config
- **Handle scaling** automatically (multiple instances of the same service behind a load balancer)
- **Health-check services** and remove unhealthy instances from the pool

What a static config file **cannot** do:
- Automatically detect when a service moves to a new host/port
- Handle horizontal scaling (multiple replicas)
- Self-heal by removing crashed instances from the routing table

For production systems, dynamic discovery (Consul, Kubernetes DNS, AWS Cloud Map) is the preferred approach.

---

## 5. Part C — Cloud Deployment

### Platform

**Render** (https://render.com) — free tier, supports Docker containers.

### Deployment Steps

1. **Push the repository** to GitHub
2. **Create a new Web Service** on Render for the API Gateway:
   - Connect the GitHub repository
   - Set the root directory to `LAB7/api-gateway`
   - Build command: `npm install`
   - Start command: `npm start`
   - Set environment variables:
     - `USER_SERVICE_URL` → internal Render service URL for user-service
     - `PRODUCT_SERVICE_URL` → internal Render service URL for product-service
     - `ORDER_SERVICE_URL` → internal Render service URL for order-service
3. **Create Web Services** for User, Product, and Order services similarly
4. **Set MongoDB Atlas connection strings** as environment variables on each service
5. **Confirm** the gateway has a public URL and Postman tests pass against it

### Environment Variables for Cloud

```
GATEWAY_PORT=3000
USER_SERVICE_URL=https://<user-service>.onrender.com
PRODUCT_SERVICE_URL=https://<product-service>.onrender.com
ORDER_SERVICE_URL=https://<order-service>.onrender.com
MONGO_URI=mongodb+srv://<user>:<pass>@cluster0.mongodb.net/<db_name>
```

---

## 6. Discussion: Why an API Gateway?

**Why introduce an API Gateway instead of letting clients call each service directly?**

1. **Single entry point** — Clients only need to know one URL. They don't need to track the addresses of User, Product, and Order services individually.

2. **Hides internal structure** — The number of microservices, their ports, and their internal Docker network topology are invisible to outside clients. Services can be refactored, split, or merged without changing the client.

3. **Centralized cross-cutting concerns**:
   - **Logging** — every request is logged in one place, not scattered across three services.
   - **Error handling** — consistent 502/504 responses when a backend is down, instead of raw connection errors.
   - **Authentication/rate limiting** (future) — can be added at the gateway layer without modifying each service.

4. **Security** — Only port 3000 is exposed to the internet. Backend services listen on the private Docker network and are not directly accessible.

---

## 7. Project Structure

```
LAB7/
├── api-gateway/
│   ├── server.js                 # Gateway with logging, proxy, error handling
│   ├── service-registry.json     # Config-based service discovery
│   ├── package.json
│   ├── Dockerfile
│   └── .dockerignore
├── user-service/
│   ├── server.js
│   ├── package.json
│   ├── Dockerfile
│   └── .dockerignore
├── product-service/
│   ├── server.js
│   ├── package.json
│   ├── Dockerfile
│   └── .dockerignore
├── order-service/
│   ├── server.js
│   ├── package.json
│   ├── Dockerfile
│   └── .dockerignore
├── compose.yaml                  # Only gateway port exposed
├── .env                          # Service URLs + MongoDB Atlas strings
├── .env.example
├── Lab7_API_Gateway.postman_collection.json
├── Screenshots/
└── README.md
```

---

## 8. How to Run Locally

```bash
# 1. Clone / navigate to the LAB7 directory
cd LAB7

# 2. Copy and configure environment variables
cp .env.example .env
# Edit .env with your actual MongoDB Atlas credentials

# 3. Build and start all containers
docker compose up --build

# 4. Test the gateway
curl http://localhost:3000/health
curl http://localhost:3000/users
curl http://localhost:3000/products
curl http://localhost:3000/orders

# 5. Test error handling (stop a service and hit its route)
docker compose stop user-service
curl http://localhost:3000/users
# Should return 502 Bad Gateway

# 6. Restart the stopped service
docker compose start user-service
```

---

## 9. Troubleshooting Notes

| Issue | Solution |
|---|---|
| Gateway returns 502 for all routes | Check that backend services are running: `docker compose ps` |
| MongoDB connection fails | Verify Atlas connection string in `.env` and ensure IP whitelist includes `0.0.0.0/0` |
| Port 3000 already in use | Change `GATEWAY_PORT` in `.env` or stop conflicting process |
| Services can't reach each other | Ensure all services are on the same Docker network (`campus-network`) |
| Cloud deployment: services unreachable | Update `USER_SERVICE_URL`, `PRODUCT_SERVICE_URL`, `ORDER_SERVICE_URL` with the cloud platform's internal URLs |

---

## 10. Reflection (5-8 Lines)

Compared to Lab 6, the gateway and cloud deployment fundamentally changed how the system is used and operated. In Lab 6, each microservice was directly accessible on its own port — clients needed to know three different addresses. In Lab 7, the API Gateway became the **single public entry point**, hiding all internal services behind one URL and one port. This brought centralized logging (every request logged in one place with method, path, target, status, and duration) and centralized error handling (clean 502/504 responses instead of raw connection failures). The configuration-based service discovery means we can change where any service lives — locally, on a different port, or on a cloud host — by editing a config file or environment variable, with **zero code changes**. Deploying to the cloud with Docker containers on Render/Railway proved that the same `compose.yaml` and config-driven approach works identically whether running on `localhost` or a public URL. The biggest insight is that an API Gateway is not just a convenience — it is an essential architectural layer for security (only one port exposed), observability (unified logging), and operational flexibility (config-driven routing).
