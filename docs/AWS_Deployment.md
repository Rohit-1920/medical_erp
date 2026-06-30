# MedERP — Complete AWS EC2 Deployment Guide

This guide walks you through deploying the EduBlitz Medical B2B ERP system on a fresh AWS EC2 instance, from creating the MongoDB database to having a working application in your browser. It assumes **no prior AWS or MongoDB Atlas experience**.

The stack you're deploying:
- 3 Spring Boot microservices (`user-service`, `product-service`, `order-service`) running directly as background processes (no Docker, no Kubernetes)
- A React + Vite frontend, built as static files and served by Nginx
- MongoDB Atlas (cloud-hosted MongoDB) as the database
- Nginx as both the static file server and reverse proxy to the backend services

---

## Table of Contents

1. [Part 1 — Create a MongoDB Atlas Cluster](#part-1--create-a-mongodb-atlas-cluster)
2. [Part 2 — Launch an EC2 Instance](#part-2--launch-an-ec2-instance)
3. [Part 3 — Connect and Install Prerequisites](#part-3--connect-and-install-prerequisites)
4. [Part 4 — Clone the Repository](#part-4--clone-the-repository)
5. [Part 5 — Configure Environment Variables](#part-5--configure-environment-variables)
6. [Part 6 — Build the Backend Services](#part-6--build-the-backend-services)
7. [Part 7 — Run Backend Services with systemd](#part-7--run-backend-services-with-systemd)
8. [Part 8 — Build and Deploy the Frontend](#part-8--build-and-deploy-the-frontend)
9. [Part 9 — Configure Nginx](#part-9--configure-nginx)
10. [Part 10 — Bootstrap Your First Organization and Admin User](#part-10--bootstrap-your-first-organization-and-admin-user)
11. [Part 11 — Add a Distributor, Products, and Stock](#part-11--add-a-distributor-products-and-stock)
12. [Part 12 — Verify the Full Order Flow](#part-12--verify-the-full-order-flow)
13. [Troubleshooting](#troubleshooting)
14. [Security Checklist Before Going Live](#security-checklist-before-going-live)

---

## Part 1 — Create a MongoDB Atlas Cluster

MongoDB Atlas is a free, cloud-hosted MongoDB service. You do **not** need to install MongoDB on your EC2 instance.

1. Go to [https://cloud.mongodb.com](https://cloud.mongodb.com) and sign up for a free account (or log in if you have one).
2. Click **Create a new Project**, give it a name (e.g. `medical-erp`), and click **Next** → **Create Project**.
3. Click **Build a Database**.
4. Choose the **M0 Free** tier (sufficient for development/testing).
5. Choose a cloud provider and region — pick a region geographically close to your EC2 instance's region for lower latency (e.g. if your EC2 is in `ap-south-1` (Mumbai), choose AWS Mumbai here too).
6. Click **Create Deployment**.

### Create a database user

1. You'll be prompted to create a database user. Choose **Username and Password** authentication.
2. Set a username (e.g. `admin`) and click **Autogenerate Secure Password**, then **copy and save this password somewhere safe** — you will need it shortly and it will not be shown again.
3. Click **Create Database User**.

### Allow network access

1. Under **Network Access** (left sidebar), click **Add IP Address**.
2. For initial setup/testing, you can click **Allow Access from Anywhere** (`0.0.0.0/0`). This is the simplest option but is not recommended for production — see the [Security Checklist](#security-checklist-before-going-live) at the end of this guide for how to restrict this properly once your EC2 instance has a static IP.
3. Click **Confirm**.

### Get your connection string

1. Go to **Database** (left sidebar) → click **Connect** on your cluster.
2. Choose **Drivers**.
3. Copy the connection string. It will look like:
   ```
   mongodb+srv://admin:<db_password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0
   ```
4. Replace `<db_password>` with the actual password you saved earlier. **Save this full connection string** — you'll use it (with database names appended) in Part 5.

You do not need to manually create databases or collections — Spring Boot and MongoDB will create them automatically the first time data is written.

---

## Part 2 — Launch an EC2 Instance

1. Log in to the [AWS Console](https://console.aws.amazon.com) and navigate to **EC2**.
2. Click **Launch Instance**.
3. **Name**: give it something recognizable, e.g. `medical-erp-server`.
4. **Application and OS Images**: choose **Ubuntu Server 22.04 LTS** (or newer).
5. **Instance type**: choose at least **t3.medium** (2 vCPU, 4GB RAM) or a similarly sized instance. The application runs 3 Java services plus a frontend build, and a t2/t3.micro (1GB RAM) will likely run out of memory.
6. **Key pair**: create a new key pair (or use an existing one), download the `.pem` file, and keep it safe — you cannot download it again later. You'll use this to SSH into the instance.
7. **Network settings**:
   - Click **Edit**.
   - Ensure **Allow SSH traffic** is checked, ideally scoped to **My IP** rather than `0.0.0.0/0`.
   - Check **Allow HTTP traffic from the internet** (port 80).
   - Check **Allow HTTPS traffic from the internet** (port 443) if you plan to add SSL later.
   - Do **not** open ports 8081–8083 publicly — these will only be accessed internally via Nginx.
8. **Configure storage**: at least **20 GB** (gp3).
9. Click **Launch Instance**.
10. Once the instance state shows **Running**, note its **Public IPv4 address** from the instance details page — you'll need this throughout the guide. (Optional but recommended: allocate an **Elastic IP** and associate it with this instance so the IP doesn't change on reboot.)

---

## Part 3 — Connect and Install Prerequisites

### Connect via SSH

From your local machine, in the same directory as your downloaded `.pem` file:

```bash
chmod 400 your-key.pem
ssh -i your-key.pem ubuntu@<your-ec2-public-ip>
```

Replace `<your-ec2-public-ip>` with the actual IP from Part 2.

### Update the system and install Java, Maven, Git, Nginx

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y openjdk-17-jdk maven git nginx curl
```

Verify installs:
```bash
java -version    # should show version 17.x
mvn -version
git --version
nginx -v
```

### Install Node.js (via nvm)

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
nvm install 18
node -v          # should show v18.x
npm -v
```

### Add swap space (important on instances with 4GB RAM or less)

Running 3 JVMs simultaneously can exceed available memory during builds or under load. A swap file prevents the OOM killer from terminating your services.

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h    # confirm "Swap:" row shows 2.0Gi
```

---

## Part 4 — Clone the Repository

```bash
cd ~
git clone https://github.com/Rohit-1920/medical_erp.git
cd medical_erp
ls
```

You should see: `frontend`, `user-service`, `product-service`, `order-service`, `docker`, `k8s`, `terraform`, `jenkins`, `docs`, `README.md`.

> Note: this guide deploys the application directly on the EC2 instance without Docker or Kubernetes. The `docker/` and `k8s/` folders in the repo are not used in this deployment path.

---

## Part 5 — Configure Environment Variables

Each backend service needs its own `.env` file. The repository includes `.env.example` files showing the required variables — **copy these, don't edit them directly**, so you always have the template available.

### Generate a shared JWT secret

All three services must use the **exact same** JWT secret, since tokens issued by `user-service` are validated by `product-service` and `order-service`.

```bash
openssl rand -hex 32
```

Copy the output — you'll paste it into all three `.env` files below.

### user-service

```bash
cd ~/medical_erp/user-service
cp .env.example .env
nano .env
```

Fill in (replace placeholders with your real values from Part 1 and the JWT secret above):

```env
MONGODB_URI=mongodb+srv://admin:<db_password>@cluster0.xxxxx.mongodb.net/users_db?retryWrites=true&w=majority&appName=Cluster0
JWT_SECRET=<paste-generated-secret-here>
JWT_EXPIRATION=86400000
JWT_REFRESH_EXPIRATION=604800000
CORS_ALLOWED_ORIGINS=http://localhost:5173,http://<your-ec2-public-ip>
```

> Important: append the specific database name to the URI path (`users_db` here). Each service uses a separate database within the same cluster.

Save with `Ctrl+O`, Enter, then exit with `Ctrl+X`.

### product-service

```bash
cd ~/medical_erp/product-service
cp .env.example .env
nano .env
```

```env
MONGODB_URI=mongodb+srv://admin:<db_password>@cluster0.xxxxx.mongodb.net/products_db?retryWrites=true&w=majority&appName=Cluster0
JWT_SECRET=<same-secret-as-above>
CORS_ALLOWED_ORIGINS=http://localhost:5173,http://<your-ec2-public-ip>
LOW_STOCK_THRESHOLD=10
```

### order-service

```bash
cd ~/medical_erp/order-service
cp .env.example .env
nano .env
```

```env
MONGODB_URI=mongodb+srv://admin:<db_password>@cluster0.xxxxx.mongodb.net/orders_db?retryWrites=true&w=majority&appName=Cluster0
JWT_SECRET=<same-secret-as-above>
CORS_ALLOWED_ORIGINS=http://localhost:5173,http://<your-ec2-public-ip>
PRODUCT_SERVICE_URL=http://localhost:8082/api/v1
USER_SERVICE_URL=http://localhost:8081/api/v1
```

### frontend

The frontend will be reverse-proxied through Nginx, so it doesn't need direct backend ports — it talks to relative paths that Nginx forwards to the right service (configured in Part 9).

```bash
cd ~/medical_erp/frontend
nano .env.local
```

```env
VITE_USER_SERVICE_URL=/api/user
VITE_PRODUCT_SERVICE_URL=/api/product
VITE_ORDER_SERVICE_URL=/api/order
```

> Vite automatically loads `.env.local` — there's no extra step needed to enable it.

---

## Part 6 — Build the Backend Services

Build each service one at a time so you can catch errors early.

```bash
cd ~/medical_erp/user-service
mvn clean package -DskipTests

cd ~/medical_erp/product-service
mvn clean package -DskipTests

cd ~/medical_erp/order-service
mvn clean package -DskipTests
```

Each should finish with `BUILD SUCCESS`. If a build fails, **do not proceed** — read the Maven error output, it almost always points to a missing dependency or a Java version mismatch.

Confirm the jars exist:

```bash
ls ~/medical_erp/user-service/target/*.jar
ls ~/medical_erp/product-service/target/*.jar
ls ~/medical_erp/order-service/target/*.jar
```

---

## Part 7 — Run Backend Services with systemd

Running services with systemd means they restart automatically on crash and on instance reboot, and keep running after you disconnect SSH.

> Replace `ubuntu` below with your actual EC2 username (it's `ubuntu` for Ubuntu AMIs). If you're logged in as `root`, use `root` instead and adjust `/home/ubuntu/` paths to `/root/` accordingly.

### user-service

```bash
sudo nano /etc/systemd/system/user-service.service
```

```ini
[Unit]
Description=User Service
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/root/medical_erp/user-service
EnvironmentFile=/root/medical_erp/user-service/.env
ExecStart=/usr/bin/java -jar target/user-service-1.0.0.jar
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

### product-service

```bash
sudo nano /etc/systemd/system/product-service.service
```

```ini
[Unit]
Description=Product Service
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/root/medical_erp/product-service
EnvironmentFile=/root/medical_erp/product-service/.env
ExecStart=/usr/bin/java -jar target/product-service-1.0.0.jar
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

### order-service

```bash
sudo nano /etc/systemd/system/order-service.service
```

```ini
[Unit]
Description=Order Service
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/root/medical_erp/order-service
EnvironmentFile=/root/medical_erp/order-service/.env
ExecStart=/usr/bin/java -jar target/order-service-1.0.0.jar
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

### Confirm the java path matches

```bash
which java
```

If this prints something other than `/usr/bin/java`, edit all three `ExecStart` lines above to match.

### Enable and start all three

```bash
sudo systemctl daemon-reload
sudo systemctl enable user-service product-service order-service
sudo systemctl start user-service product-service order-service
```

### Check status

```bash
sudo systemctl status user-service
sudo systemctl status product-service
sudo systemctl status order-service
```

Each should show `active (running)`. Press `q` to exit the status view.

If a service shows `failed`, check its logs:
```bash
journalctl -u user-service -n 50 --no-pager
```

### Verify health endpoints

```bash
curl http://localhost:8081/api/v1/actuator/health
curl http://localhost:8082/api/v1/actuator/health
curl http://localhost:8083/api/v1/actuator/health
```

Each should return `{"status":"UP"}`. If any returns a connection error, the service isn't running — check its systemd status and logs. If it returns `DOWN` with a MongoDB-related error, double-check your `MONGODB_URI` in that service's `.env` file (most common cause: wrong password, or missing/incorrect database name in the URI path).

---

## Part 8 — Build and Deploy the Frontend

```bash
cd ~/medical_erp/frontend
npm install
npx vite build
```

> Why `npx vite build` instead of `npm run build`: the default `npm run build` script runs a strict TypeScript check (`tsc`) before bundling, which can fail on pre-existing unused-import warnings in the source code that don't affect runtime behavior. `npx vite build` skips that check and builds directly — this is safe for deployment purposes.

This produces a `dist/` folder. Copy it to where Nginx will serve it from:

```bash
sudo mkdir -p /var/www/erp
sudo cp -r dist/* /var/www/erp/
```

---

## Part 9 — Configure Nginx

Nginx will serve the frontend's static files and reverse-proxy API calls to the three backend services, so the browser only ever talks to port 80 (or 443 if you add HTTPS).

```bash
sudo nano /etc/nginx/sites-available/erp
```

Paste:

```nginx
server {
    listen 80;
    server_name _;

    root /var/www/erp;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/user/ {
        proxy_pass http://localhost:8081/api/v1/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api/product/ {
        proxy_pass http://localhost:8082/api/v1/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api/order/ {
        proxy_pass http://localhost:8083/api/v1/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable the site and remove the default:

```bash
sudo ln -s /etc/nginx/sites-available/erp /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
```

`nginx -t` must report `syntax is ok` and `test is successful` before you continue. If it errors, re-check the config file for typos before restarting.

```bash
sudo systemctl restart nginx
sudo systemctl enable nginx
```

### Verify everything end-to-end

```bash
curl http://localhost/
curl http://localhost/api/user/actuator/health
curl http://localhost/api/product/actuator/health
curl http://localhost/api/order/actuator/health
```

The first should return HTML; the other three should return `{"status":"UP"}`.

Now open `http://<your-ec2-public-ip>` in a browser. You should see the MedERP login/register screen.

---

## Part 10 — Bootstrap Your First Organization and Admin User

This is the part most people get stuck on: **the registration form requires a valid Organization ID, but there is no UI to create an organization.** Organization creation is an admin-only API endpoint with no corresponding frontend form in this version of the codebase. You must create your first organization via the API directly.

Since creating an organization requires an ADMIN-role JWT token, and you have no users yet, this is a one-time chicken-and-egg step.

### Check the actual organization creation requirements

Open `user-service/src/main/java/com/edublitz/userservice/controller/OrganizationController.java` if you want to see the exact validation, but in short, the request body looks like this:

```bash
curl -X POST http://localhost:8081/api/v1/organizations \
  -H "Content-Type: application/json" \
  -d '{
    "name": "City General Hospital",
    "registrationNumber": "HOSP-001",
    "type": "HOSPITAL",
    "address": {"street": "123 Main St","city": "Mumbai","state": "MH","pincode": "400001","country": "India"},
    "contactEmail": "admin@yourdomain.com",
    "contactPhone": "+91-9876543210",
    "active": true
  }'
```

> If this returns a `403 Forbidden`, it means organization creation is locked behind `ADMIN` role authentication in your current code version, which creates a bootstrapping problem (you need an admin to create an org, but you need an org to register a user, including the first admin). If you hit this, the only way around it without modifying code is to **temporarily run the curl command directly against the database** via `mongosh` or the Atlas UI ("Insert Document" in the `organizations` collection within `users_db`), constructing a document with the same fields shown above plus an auto-generated `_id`. Once one organization exists, you can register a HOSPITAL or DISTRIBUTOR user against it (registration itself is NOT admin-protected), and from there promote that user or create further organizations using their token if their role allows it.
>
> If it succeeds directly (the endpoint may not actually be role-protected in your version — check the controller source to confirm), copy the `id` from the JSON response.

### Register your first user against that organization

Take the organization `id` from the previous step and use it here. You can do this either via the browser at `http://<your-ec2-public-ip>/register`, or via curl:

```bash
curl -X POST http://localhost:8081/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "Admin",
    "lastName": "User",
    "email": "admin@yourdomain.com",
    "password": "ChangeThisPassword123!",
    "role": "ADMIN",
    "organizationId": "<paste-the-organization-id-here>"
  }'
```

This returns an `accessToken` — save it, you'll need it for the next steps.

> **Important detail learned from real deployment testing**: a user's `role` (e.g. `ADMIN`) and their organization's `type` (e.g. `HOSPITAL`) are independent fields. If you register an `ADMIN`-role user against a `HOSPITAL`-type organization, that admin's per-organization dashboard views (Inventory, Incoming Orders) will appear empty, because those views are scoped to the user's own `organizationId`, not a platform-wide view. This is expected behavior in the current codebase, not a bug — keep this in mind when testing.

---

## Part 11 — Add a Distributor, Products, and Stock

### Create a distributor organization

Using the admin access token from Part 10:

```bash
curl -X POST http://localhost:8081/api/v1/organizations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <admin-access-token>" \
  -d '{
    "name": "ABC Distributors Pvt Ltd",
    "registrationNumber": "DIST-001",
    "type": "DISTRIBUTOR",
    "address": {"street": "456 Market Rd","city": "Pune","state": "MH","pincode": "411001","country": "India"},
    "contactEmail": "distributor@yourdomain.com",
    "contactPhone": "+91-9876543211",
    "active": true
  }'
```

Copy the returned `id`.

### Register a distributor user

Go to `http://<your-ec2-public-ip>/register` in the browser, fill in the form, set **Role: Distributor**, and paste the organization `id` from above into the **Organization ID** field. Submit.

### Add a product (from the browser, while logged in as the distributor)

Go to **Products** → **+ Add Product**, fill in the form, and submit. This creates the product catalog entry but **does not** add any stock quantity — those are two separate concepts in this system.

### Add stock for that product

There is no UI for this in the current codebase — it must be done via API. First find the product's ID:

```bash
curl http://localhost:8082/api/v1/products \
  -H "Authorization: Bearer <distributor-access-token>"
```

Copy the `id` field of the product you want to stock, then:

```bash
curl -X POST http://localhost:8082/api/v1/products/inventory \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <distributor-access-token>" \
  -d '{
    "productId": "<product-id-from-above>",
    "warehouseId": "WH-01",
    "warehouseLocation": "Main Warehouse",
    "batchNumber": "BATCH-001",
    "manufacturingDate": "2026-01-01",
    "expiryDate": "2028-01-01",
    "quantity": 100,
    "reorderLevel": 10,
    "distributorId": "<distributor-organization-id>"
  }'
```

> If you skip this step, orders placed for this product will fail to be approved with the error `"Insufficient stock for product: <name>"`.

---

## Part 12 — Verify the Full Order Flow

1. Register a **HOSPITAL**-role user against City General Hospital (or any hospital org you've created), via the browser register form.
2. Log in as that hospital user, go to **Orders** → **+ New Order**.
3. Select the distributor you created, choose a product (you should now see the product you stocked in Part 11), set a quantity, fill in a shipping address, and click **Place Order**.
4. Log out, log back in as the distributor user.
5. Go to **Dashboard** — you should see the order under "Pending Approvals." Click **Approve**.
6. The order status should change to `APPROVED`. You've now validated the full chain: organization → user registration → product → stock → order → approval.

---

## Troubleshooting

**`mvn clean package` fails** — read the actual Maven error message; it's almost always either a missing dependency download (check your EC2's internet/network access) or an incompatible Java version. Confirm `java -version` shows 17.

**`npm` / `npx vite build` fails with TypeScript errors** — use `npx vite build` directly instead of `npm run build`, which skips the strict `tsc` type-check gate. Pre-existing unused-import warnings in this codebase don't affect runtime.

**A systemd service shows `failed`** — run `journalctl -u <service-name> -n 50 --no-pager` and read the actual exception. The most common cause is a malformed `MONGODB_URI` (wrong password, or missing database name in the path) or a `JWT_SECRET` mismatch between services.

**`curl .../actuator/health` returns nothing or connection refused** — the service isn't running, or you're hitting the wrong port. Re-check `systemctl status <service-name>`.

**Buttons in the UI ("Add Product", "New Order") do nothing when clicked** — open browser DevTools (F12) → Network tab → click the button again. If **no request fires at all**, the button has no handler wired up in this version of the frontend code (this affected the original "Add Product" and "New Order" buttons in early versions of this repo — confirm you're on a version of this codebase where they've been wired up, or check `frontend/src/pages/ProductsPage.tsx` and `OrdersPage.tsx` for an `onClick` handler on the relevant button).

**Order approval fails with `"Insufficient stock for product: X"`** — you created the product but never added inventory stock for it. See [Part 11](#part-11--add-a-distributor-products-and-stock).

**Registration fails with `"Organization ID is required"` or a 400 error mentioning the org ID** — the Organization ID field expects a real MongoDB ObjectId (24-character hex string) of an organization that already exists, not an arbitrary number. See [Part 10](#part-10--bootstrap-your-first-organization-and-admin-user).

**A logged-in user's dashboard/inventory/orders pages show all zeros despite data existing elsewhere** — dashboards are scoped to the logged-in user's own `organizationId`. A user belonging to a hospital organization will never see distributor inventory data, even with an `ADMIN` role. Log in as a user from the organization that actually owns the data you're trying to view.

**Out-of-memory crashes / services randomly restarting** — confirm swap is enabled (`free -h`) and consider capping JVM heap per service by adding `Environment="JAVA_OPTS=-Xmx512m"` and changing `ExecStart` to `/usr/bin/java $JAVA_OPTS -jar target/<service>.jar` in each systemd unit file, then `sudo systemctl daemon-reload && sudo systemctl restart <service>`.

---

## Security Checklist Before Going Live

This guide gets the application running for development/testing purposes. Before exposing it to real users or real data, address the following:

- [ ] **Restrict MongoDB Atlas Network Access** from `0.0.0.0/0` to your EC2 instance's specific public IP (or use an Atlas VPC peering connection for production).
- [ ] **Restrict the EC2 security group**: only port 22 (SSH, scoped to your IP) and port 80/443 need to be open publicly. Backend ports 8081–8083 should never be open to the internet — Nginx proxies them internally.
- [ ] **Add HTTPS**: use [Let's Encrypt](https://letsencrypt.org/) via `certbot` once you have a domain name pointed at your EC2 instance's IP. Without HTTPS, login credentials and JWT tokens travel in plaintext.
- [ ] **Use strong, unique passwords** for your MongoDB Atlas database user and all application accounts — do not reuse the same password across systems.
- [ ] **Rotate the JWT secret** periodically and after any suspected exposure.
- [ ] **Never commit `.env` files to git** — only commit `.env.example` files with placeholder values. Check `.gitignore` includes `.env`, `.env.local`, and `**/.env` before your first commit.
- [ ] **Set up MongoDB Atlas backups** (available even on some free/shared tiers, full backup support on paid tiers) rather than relying solely on Atlas's default retention.
- [ ] **Review and tighten `CORS_ALLOWED_ORIGINS`** in each service's `.env` to only include your actual frontend domain, not wildcard or development origins, once in production.
- [ ] **Consider adding rate limiting** at the Nginx layer for `/api/user/auth/login` and `/api/user/auth/register` to mitigate brute-force attempts.
