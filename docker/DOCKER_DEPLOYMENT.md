# MedERP — Docker Deployment Guide

Deploy the entire MedERP stack with a single command using Docker Compose.
This replaces the manual systemd + Nginx setup from the bare-EC2 guide.

---

## What Docker Gives You Over Bare EC2

| Bare EC2 | Docker |
|----------|--------|
| Install Java, Maven, Node manually | Only Docker needed |
| Create 3 systemd service files | One `docker-compose.yml` |
| Manage ports manually | Docker networking handles it |
| `User=root vs ubuntu` confusion | Containers run the same everywhere |
| `localhost` URL confusion in order-service | Docker service names work automatically |
| Manual Nginx config | Nginx runs as a container |
| Rebuild takes 10+ manual steps | `docker-compose up --build -d` |

---

## Architecture

```
Internet
    │
    ▼
┌─────────────────────────────────────┐
│  EC2 Instance                       │
│                                     │
│  ┌──────────────────────────────┐   │
│  │  frontend container (Nginx)  │   │
│  │  Port 80 → 443               │   │
│  └──────┬─────────┬──────┬─────┘   │
│         │         │      │         │
│    /api/user /api/product /api/order│
│         │         │      │         │
│  ┌──────▼──┐ ┌────▼───┐ ┌▼──────┐  │
│  │user-svc │ │prod-svc│ │ord-svc│  │
│  │  :8081  │ │  :8082 │ │ :8083 │  │
│  └─────────┘ └────────┘ └───────┘  │
│                                     │
│  All on: mederr-network (bridge)    │
└─────────────────────────────────────┘
         │
         ▼
  MongoDB Atlas (cloud)
```

---

## Prerequisites

- AWS account
- Domain name (e.g. `awswithrohit.fun`) with DNS pointing to your EC2 IP
- MongoDB Atlas cluster (free M0 tier is fine)

---

## Part 1 — Launch EC2 Instance

1. Go to AWS Console → EC2 → **Launch Instance**
2. Settings:
   - **OS**: Ubuntu Server 22.04 LTS
   - **Instance type**: `t3.medium` minimum (4GB RAM)
   - **Storage**: 30GB (Docker images need more space than bare jars)
   - **Key pair**: create/download `.pem`
3. **Security Group inbound rules**:
   - SSH (22) → My IP only
   - HTTP (80) → 0.0.0.0/0
   - HTTPS (443) → 0.0.0.0/0
   - **Do NOT open 8081, 8082, 8083** — these are internal to Docker network
4. Launch and note the **Public IPv4**

---

## Part 2 — Connect and Install Docker

```bash
chmod 400 your-key.pem
ssh -i your-key.pem ubuntu@<your-ec2-public-ip>
```

Install Docker and Docker Compose:

```bash
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Add ubuntu user to docker group (so you don't need sudo every time)
sudo usermod -aG docker ubuntu

# Install Docker Compose plugin
sudo apt install -y docker-compose-plugin

# Apply group change without logging out
newgrp docker

# Verify
docker --version
docker compose version
```

---

## Part 3 — Set Up DNS and SSL

### 3.1 Point your domain to EC2

In Route 53 (or your DNS provider), create:
- `A` record: `awswithrohit.fun` → your EC2 IP
- `A` record: `www.awswithrohit.fun` → your EC2 IP

Wait for DNS to propagate. Check with:
```bash
nslookup awswithrohit.fun
# Should return your EC2 IP
```

### 3.2 Get SSL certificate (before starting Docker)

Install certbot on the EC2 host (not inside Docker):

```bash
sudo apt install -y certbot

# Get certificate — port 80 must be free (Docker not running yet)
sudo certbot certonly --standalone \
  -d awswithrohit.fun \
  -d www.awswithrohit.fun \
  --non-interactive \
  --agree-tos \
  --email your@email.com
```

Certificates are saved to `/etc/letsencrypt/live/awswithrohit.fun/`.
The Docker Nginx container mounts this path as a read-only volume.

Set up auto-renewal:
```bash
sudo certbot renew --dry-run   # confirm it works
# Certbot installs a systemd timer automatically — no cron needed
```

---

## Part 4 — Clone Repo and Set Up Files

```bash
cd ~
git clone https://github.com/Rohit-1920/medical_erp.git
cd medical_erp
```

### 4.1 Place the Dockerfiles

Each service needs its own `Dockerfile`. Copy from the repo's `docker/` folder:

```bash
cp docker/user-service.Dockerfile     user-service/Dockerfile
cp docker/product-service.Dockerfile  product-service/Dockerfile
cp docker/order-service.Dockerfile    order-service/Dockerfile
cp docker/frontend.Dockerfile         frontend/Dockerfile
```

### 4.2 Replace frontend nginx.conf with Docker version

The Docker version proxies to container names instead of localhost ports:

```bash
cp docker/nginx.conf frontend/nginx.conf
```

### 4.3 Place .dockerignore files

```bash
cp docker/java.dockerignore  user-service/.dockerignore
cp docker/java.dockerignore  product-service/.dockerignore
cp docker/java.dockerignore  order-service/.dockerignore
cp docker/frontend.dockerignore frontend/.dockerignore
```

### 4.4 Create the .env file

```bash
cp docker/.env.example .env
nano .env
```

Fill in all values:

```env
USER_MONGODB_URI=mongodb+srv://admin:<password>@cluster0.xxxxx.mongodb.net/users_db?retryWrites=true&w=majority&appName=Cluster0
PRODUCT_MONGODB_URI=mongodb+srv://admin:<password>@cluster0.xxxxx.mongodb.net/products_db?retryWrites=true&w=majority&appName=Cluster0
ORDER_MONGODB_URI=mongodb+srv://admin:<password>@cluster0.xxxxx.mongodb.net/orders_db?retryWrites=true&w=majority&appName=Cluster0
JWT_SECRET=<run: openssl rand -hex 32>
JWT_EXPIRATION=86400000
JWT_REFRESH_EXPIRATION=604800000
CORS_ALLOWED_ORIGINS=https://awswithrohit.fun,https://www.awswithrohit.fun
LOW_STOCK_THRESHOLD=10
```

> Generate JWT secret: `openssl rand -hex 32`

---

## Part 5 — Build and Start Everything

```bash
cd ~/medical_erp

# Build all images and start all containers in background
docker compose up --build -d
```

This will:
1. Build 4 Docker images (user-service, product-service, order-service, frontend)
2. Start all containers on the `mederr-network` bridge network
3. order-service waits for user-service and product-service to be healthy before starting

First build takes 5-10 minutes (downloading Maven/Node dependencies).
Subsequent builds are faster due to Docker layer caching.

### Watch the logs

```bash
# All services
docker compose logs -f

# Single service
docker compose logs -f user-service
docker compose logs -f order-service
```

### Check all containers are running

```bash
docker compose ps
```

All should show `healthy` status. If any shows `unhealthy`, check its logs:
```bash
docker compose logs user-service
```

### Verify health endpoints

```bash
curl http://localhost/api/user/actuator/health
curl http://localhost/api/product/actuator/health
curl http://localhost/api/order/actuator/health
```

All should return `{"status":"UP"}`.

---

## Part 6 — Bootstrap Users and Organizations

Same seed script as bare-EC2, works identically:

```bash
cd ~/medical_erp
bash seed.sh
```

Output:
```
✅ Hospital org created
✅ Distributor org created
✅ ADMIN user created: admin@mederr.com
✅ DISTRIBUTOR user created: distributor@mederr.com
✅ HOSPITAL user created: hospital@mederr.com
```

---

## Part 7 — Verify

Open `https://awswithrohit.fun` in your browser.
You should see the MedERP login page with a padlock (SSL).

Login credentials:

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

### Stop and remove all data (full reset)
```bash
docker compose down -v
```

### Restart a single service
```bash
docker compose restart user-service
```

### Rebuild and redeploy after a code change
```bash
# Rebuild only the changed service (faster)
docker compose up --build -d user-service

# Rebuild everything
docker compose up --build -d
```

### View running containers
```bash
docker compose ps
docker stats          # live CPU/memory usage per container
```

### View logs
```bash
docker compose logs -f                  # all services
docker compose logs -f order-service    # single service
docker compose logs --tail=50 user-service  # last 50 lines
```

### Get a shell inside a container (for debugging)
```bash
docker exec -it user-service sh
docker exec -it order-service sh
```

### Check container health
```bash
docker inspect user-service | grep -A 10 '"Health"'
```

---

## Updating SSL Certificate

Certbot runs on the EC2 host and auto-renews. After renewal, reload Nginx inside the container to pick up the new cert:

```bash
# Renew cert (certbot does this automatically, but you can force it)
sudo certbot renew

# Reload Nginx container to use new cert
docker compose exec frontend nginx -s reload
```

---

## Troubleshooting

**`docker compose up` fails with `permission denied`**
You're not in the docker group. Run:
```bash
sudo usermod -aG docker ubuntu
newgrp docker
```

**Container shows `unhealthy`**
Check logs: `docker compose logs <service-name>`
Most common cause: wrong MongoDB URI or password in `.env`

**`order-service` fails with `UnknownHostException: product-service`**
This should NOT happen with Docker — service names resolve automatically on the bridge network. If it does, confirm all containers are on the same network:
```bash
docker network inspect medical_erp_mederr-network
```
All 4 containers should be listed.

**Port 80 already in use**
Something else is using port 80 (maybe a leftover Nginx from bare-EC2 install):
```bash
sudo systemctl stop nginx
sudo systemctl disable nginx
docker compose up -d
```

**SSL certificate not found**
The frontend container mounts `/etc/letsencrypt` from the host. Make sure you ran `certbot certonly` before `docker compose up`. Check the cert exists:
```bash
sudo ls /etc/letsencrypt/live/awswithrohit.fun/
```

**Building without a domain (IP only)**
If you don't have a domain yet, use the HTTP-only nginx.conf (no SSL). Replace `frontend/nginx.conf` with:
```nginx
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;
    location / { try_files $uri $uri/ /index.html; }
    location /api/user/    { proxy_pass http://user-service:8081/api/v1/; }
    location /api/product/ { proxy_pass http://product-service:8082/api/v1/; }
    location /api/order/   { proxy_pass http://order-service:8083/api/v1/; }
}
```
And remove the SSL volume mounts from `docker-compose.yml`.

---

## File Placement Summary

After following this guide, your repo structure should look like this:

```
medical_erp/
├── docker-compose.yml          ← root level
├── .env                        ← root level (never commit this)
├── .env.example                ← root level (safe to commit)
├── seed.sh
├── user-service/
│   ├── Dockerfile
│   ├── .dockerignore
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
│   ├── nginx.conf              ← Docker version (uses container names)
│   └── src/...
└── docker/
    ├── user-service.Dockerfile
    ├── product-service.Dockerfile
    ├── order-service.Dockerfile
    ├── frontend.Dockerfile
    ├── nginx.conf
    ├── java.dockerignore
    ├── frontend.dockerignore
    ├── .env.example
    └── DOCKER_DEPLOYMENT.md
```
