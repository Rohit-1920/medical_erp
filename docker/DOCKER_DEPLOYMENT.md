# MedERP — Docker Deployment Guide

Deploy the entire MedERP stack with a single command using Docker Compose.

---

## Why Docker Instead of Bare EC2

| Bare EC2 | Docker |
|----------|--------|
| Install Java, Maven, Node manually | Only Docker needed |
| Create 3 systemd service files | One `docker-compose.yml` |
| `User=root vs ubuntu` confusion | Containers run the same everywhere |
| `localhost` URL confusion in order-service | Docker service names work automatically |
| Manual Nginx config | Nginx runs as a container |
| 10+ manual steps to deploy | `docker compose up --build -d` |

---

## How Nginx Routing Works in Docker

This is the most important thing to understand before running any commands.

In Docker, your services are NOT exposed directly on the host.
Only Nginx (frontend container) exposes port 80.
Everything goes through Nginx.

Nginx strips the path prefix and proxies to the correct container:

```
/api/user/auth/login      → user-service:8081/api/v1/auth/login
/api/product/products     → product-service:8082/api/v1/products
/api/order/orders         → order-service:8083/api/v1/orders
```

This means:
- ✅ `http://localhost/api/user/auth/login`     — CORRECT
- ❌ `http://localhost:8081/api/v1/auth/login`  — WRONG (port not exposed)
- ❌ `http://localhost/api/user/api/v1/auth/login` — WRONG (double /api/v1)

Always use `http://localhost/api/user/...`, `http://localhost/api/product/...`,
`http://localhost/api/order/...` — not direct ports.

---

## Architecture

```
Browser
  │
  ▼ port 80
┌────────────────────────────────────┐
│  frontend container (Nginx)        │
│                                    │
│  /api/user/*    → user-service     │
│  /api/product/* → product-service  │
│  /api/order/*   → order-service    │
│  /*             → React SPA        │
└──────┬──────────────┬──────────────┘
       │              │           │
 user-service   product-service  order-service
  :8081          :8082            :8083
       │              │           │
       └──────────────┴───────────┘
                      │
               MongoDB Atlas (cloud)

All containers on: mederr-network (bridge)
Ports 8081/8082/8083 are internal only — not exposed to the internet
```

---

## Part 1 — Launch EC2 Instance

1. Go to AWS Console → EC2 → **Launch Instance**
2. Settings:
   - **OS**: Ubuntu Server 22.04 LTS
   - **Instance type**: `t3.medium` minimum (4GB RAM for 3 Java containers)
   - **Storage**: 30GB
   - **Key pair**: create/download `.pem`
3. **Security Group inbound rules**:
   - SSH port 22 → My IP only
   - HTTP port 80 → 0.0.0.0/0
   - **Do NOT open 8081, 8082, 8083** — internal to Docker only
4. Launch → note the **Public IPv4 address**

---

## Part 2 — Connect and Install Docker

```bash
chmod 400 your-key.pem
ssh -i your-key.pem ubuntu@<your-ec2-public-ip>
```

```bash
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Add ubuntu to docker group (no sudo needed)
sudo usermod -aG docker ubuntu

# Install Docker Compose plugin
sudo apt install -y docker-compose-plugin

# Apply group change without re-login
newgrp docker

# Verify
docker --version
docker compose version
```

---

## Part 3 — Clone Repo and Set Up Files

```bash
cd ~
git clone https://github.com/Rohit-1920/medical_erp.git
cd medical_erp
```

### 3.1 Copy Dockerfiles into each service folder

```bash
cp docker/user-service.Dockerfile      user-service/Dockerfile
cp docker/product-service.Dockerfile   product-service/Dockerfile
cp docker/order-service.Dockerfile     order-service/Dockerfile
cp docker/frontend.Dockerfile          frontend/Dockerfile
```

### 3.2 Copy nginx.conf into frontend folder

```bash
cp docker/nginx.conf frontend/nginx.conf
```

### 3.3 Copy .dockerignore files

```bash
cp docker/java.dockerignore     user-service/.dockerignore
cp docker/java.dockerignore     product-service/.dockerignore
cp docker/java.dockerignore     order-service/.dockerignore
cp docker/frontend.dockerignore frontend/.dockerignore
```

### 3.4 Copy docker-compose.yml to repo root

```bash
cp docker/docker-compose.yml .
```

### 3.5 Create your .env file

```bash
cp docker/.env.example .env
nano .env
```

Fill in your real values:

```env
# Get these from MongoDB Atlas → Connect → Drivers
# Append the correct database name (/users_db, /products_db, /orders_db)
USER_MONGODB_URI=mongodb+srv://admin:<password>@cluster0.xxxxx.mongodb.net/users_db?retryWrites=true&w=majority&appName=Cluster0
PRODUCT_MONGODB_URI=mongodb+srv://admin:<password>@cluster0.xxxxx.mongodb.net/products_db?retryWrites=true&w=majority&appName=Cluster0
ORDER_MONGODB_URI=mongodb+srv://admin:<password>@cluster0.xxxxx.mongodb.net/orders_db?retryWrites=true&w=majority&appName=Cluster0

# Generate: openssl rand -hex 32
# MUST be the same for all 3 services
JWT_SECRET=<your-generated-secret>

JWT_EXPIRATION=86400000
JWT_REFRESH_EXPIRATION=604800000

# Your EC2 public IP (run: curl ifconfig.me)
CORS_ALLOWED_ORIGINS=http://<your-ec2-public-ip>

LOW_STOCK_THRESHOLD=10
```

---

## Part 4 — Build and Start Everything

```bash
cd ~/medical_erp
docker compose up --build -d
```

First build takes 5-10 minutes (Maven + Node dependencies).
Subsequent builds are faster due to layer caching.

### Check all containers are running

```bash
docker compose ps
```

Wait up to 2 minutes. All 4 should show `healthy`.

### Verify health endpoints (through Nginx)

```bash
curl http://localhost/api/user/actuator/health
curl http://localhost/api/product/actuator/health
curl http://localhost/api/order/actuator/health
```

All must return `{"status":"UP"}` before continuing.

If any returns an error, check logs:
```bash
docker compose logs user-service
docker compose logs product-service
docker compose logs order-service
```

---

## Part 5 — Bootstrap Organizations and Users

```bash
cd ~/medical_erp
bash docker/docker-seed.sh
```

This creates:
- City General Hospital (HOSPITAL org)
- ABC Distributors Pvt Ltd (DISTRIBUTOR org)
- 3 default users (admin, distributor, hospital)

Output on success:
```
✅ Hospital org created
✅ Distributor org created
✅ ADMIN user created: admin@mederr.com
✅ DISTRIBUTOR user created: distributor@mederr.com
✅ HOSPITAL user created: hospital@mederr.com
```

> Safe to run multiple times — skips anything that already exists.

---

## Part 6 — Test the Full Workflow

### Step 1 — Add a product (as Distributor)

1. Open `http://<your-ec2-public-ip>` in browser
2. Log in as `distributor@mederr.com` / `Dist@1234`
3. Go to **Products** → **+ Add Product** → fill the form → Save

### Step 2 — Add stock (required for order approval)

After adding a product, run:

```bash
bash docker/docker-add-stock.sh
```

This automatically adds 1000 units of stock for every product belonging to the distributor.

> Without stock, the distributor cannot approve orders — you will get "Insufficient stock" error.

### Step 3 — Place an order (as Hospital)

1. Log out → Log in as `hospital@mederr.com` / `Hosp@1234`
2. Go to **Orders** → **+ New Order**
3. Select distributor → pick a product → set quantity and shipping address → **Place Order**

### Step 4 — Approve the order (as Distributor)

1. Log out → Log in as `distributor@mederr.com` / `Dist@1234`
2. Go to **Dashboard** → see order under Pending Approvals → click **Approve**
3. Order status changes to `APPROVED`

---

## Login Credentials

| Role | Email | Password |
|------|-------|----------|
| ADMIN | admin@mederr.com | Admin@1234 |
| DISTRIBUTOR | distributor@mederr.com | Dist@1234 |
| HOSPITAL | hospital@mederr.com | Hosp@1234 |

---

## Day-to-Day Operations

### Stop everything
```bash
docker compose down
```

### Start again (no rebuild)
```bash
docker compose up -d
```

### Full reset (wipes everything and rebuilds)
```bash
docker compose down
docker compose up --build -d
bash docker/docker-seed.sh
```

### Rebuild after a code change
```bash
# One service
docker compose up --build -d user-service

# Everything
docker compose up --build -d
```

### View logs
```bash
docker compose logs -f                      # all services live
docker compose logs -f order-service        # one service live
docker compose logs --tail=50 user-service  # last 50 lines
```

### Get a shell inside a container
```bash
docker exec -it user-service sh
docker exec -it order-service sh
```

### Live resource usage
```bash
docker stats
```

---

## Troubleshooting

**`permission denied` when running docker**
```bash
sudo usermod -aG docker ubuntu
newgrp docker
```

**Container shows `unhealthy` after 2 minutes**
```bash
docker compose logs user-service | grep -i "error\|exception\|failed"
```
Most common cause: wrong MongoDB URI or password in `.env`

**Port 80 already in use**
A leftover Nginx from bare-EC2 is blocking port 80:
```bash
sudo systemctl stop nginx
sudo systemctl disable nginx
docker compose up -d
```

**`curl localhost:8081` returns connection refused**
This is expected — ports 8081/8082/8083 are not exposed on the host.
Always use `http://localhost/api/user/...` instead (through Nginx).

**Order approval fails with `Insufficient stock`**
You skipped adding stock. Run:
```bash
bash docker/docker-add-stock.sh
```

**Products not showing in New Order modal**
Add products while logged in as the DISTRIBUTOR account.
Products added by other roles get the wrong `distributorId`.

**`order-service` unhealthy — connection to product-service fails**
This should NOT happen with Docker (service names resolve automatically).
If it does:
```bash
docker network inspect medical_erp_mederr-network
```
All 4 containers must be listed on the same network.

**docker-seed.sh returns 403 on all endpoints**
Your `user-service` is not responding correctly. Check:
```bash
curl -i http://localhost/api/user/actuator/health
docker compose logs user-service | tail -30
```

---

## File Structure After Setup

```
medical_erp/
├── docker-compose.yml          ← copied from docker/ (root level)
├── .env                        ← your real values (NEVER commit)
├── seed.sh                     ← bare-EC2 bootstrap (not used with Docker)
├── user-service/
│   ├── Dockerfile              ← copied from docker/
│   ├── .dockerignore           ← copied from docker/
│   └── src/...
├── product-service/
│   ├── Dockerfile
│   ├── .dockerignore
│   └── src/...
├── order-service/
│   ├── Dockerfile
│   ├── .dockerignore
│   └── src/...
├── frontend/
│   ├── Dockerfile
│   ├── .dockerignore
│   ├── nginx.conf              ← Docker version (proxies to container names)
│   └── src/...
└── docker/
    ├── DOCKER_DEPLOYMENT.md    ← this file
    ├── docker-compose.yml
    ├── docker-seed.sh          ← Docker bootstrap script
    ├── docker-add-stock.sh     ← Docker stock addition script
    ├── .env.example
    ├── nginx.conf
    ├── java.dockerignore
    ├── frontend.dockerignore
    ├── user-service.Dockerfile
    ├── product-service.Dockerfile
    ├── order-service.Dockerfile
    └── frontend.Dockerfile
```
