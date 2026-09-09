# Paper Trade — Business Management System

A production-ready, local-first ERP and accounting platform designed specifically for paper merchants, paper converters, and warehouse distributors.

Built with **Next.js 14 App Router** (standalone multi-stage build), **PostgreSQL 16 Alpine**, **Prisma ORM 5.22.0**, and **Auth.js**.

The entire system is completely **airgapped** and runs 100% locally with zero external cloud dependencies. A single primary PC acts as the **Server Machine**, allowing multiple billing, counter, and warehouse workstations to connect simultaneously over a standard Local Area Network (LAN cable or Wi-Fi).

---

## Table of Contents
1. [Architecture & Business Logic](#architecture--business-logic)
2. [Quick Launch Procedure (Daily Operations)](#quick-launch-procedure-daily-operations)
   - [Windows Daily Launch & Shutdown](#windows-daily-launch--shutdown)
   - [Linux Daily Launch & Shutdown](#linux-daily-launch--shutdown)
3. [Setup Guide on a New Device (First-Time Setup)](#setup-guide-on-a-new-device-first-time-setup)
   - [Option A: Windows Setup (Windows 10 / 11)](#option-a-windows-setup-windows-10--11)
   - [Option B: Linux Setup (Ubuntu / Debian / Fedora / Arch)](#option-b-linux-setup-ubuntu--debian--fedora--arch)
4. [Desktop Shortcut Setup](#desktop-shortcut-setup)
   - [Windows Desktop Shortcut](#windows-desktop-shortcut)
   - [Linux Application Launcher (.desktop)](#linux-application-launcher-desktop)
5. [Local Area Network (LAN) Multi-PC Access](#local-area-network-lan-multi-pc-access)
   - [Finding Server IP Address](#finding-server-ip-address)
   - [Configuring the Firewall](#configuring-the-firewall)
   - [Connecting from Client Workstations](#connecting-from-client-workstations)
6. [Database Backup & Restore Operations](#database-backup--restore-operations)
7. [Troubleshooting & Diagnostics](#troubleshooting--diagnostics)
8. [Developer Conventions & Maintenance](#developer-conventions--maintenance)

---

## Architecture & Business Logic

```
   [Counter PC 1 / Cashier]             [Warehouse PC 2]              [Manager Laptop]
     (Web Browser)                        (Web Browser)                 (Web Browser)
           │                                    │                             │
           └────────────────────────┬───────────┴─────────────────────────────┘
                                    │ Local Office LAN (Cable / Wi-Fi)
                                    ▼
         ┌─────────────────────────────────────────────────────────────┐
         │              Server PC (Windows or Linux)                   │
         │                                                             │
         │  ┌───────────────────────────────────────────────────────┐  │
         │  │                 Docker Compose Stack                  │  │
         │  │                                                       │  │
         │  │  ┌───────────────────────┐  ┌──────────────────────┐  │  │
         │  │  │   papertrade-app      │  │    papertrade-db     │  │  │
         │  │  │ Next.js 14 Standalone │  │ PostgreSQL 16 Alpine │  │  │
         │  │  │ (Port 3000)           │◄─┤ (Port 5432)          │  │  │
         │  │  └───────────────────────┘  └──────────┬───────────┘  │  │
         │  └────────────────────────────────────────┼──────────────┘  │
         │                                           ▼                 │
         │                             [Persistent Storage Volume]     │
         │                             [Nightly Backups Folder]        │
         └─────────────────────────────────────────────────────────────┘
```

- **Packet-First Industry Dealing**:
  All local customer transactions default to **Packets** (1 Ream = 5 Packets, 1 Packet = 100 Sheets). Reorder thresholds, stock valuation, and prices are evaluated in packet equivalents.
- **Walk-in & Long-Term Client Billing**:
  Cashiers can invoice registered accounts with ledger balances or immediate walk-in counter clients with instant cash settlement.
- **Transactional Consistency**:
  Every multi-table action (Sales, Purchases, Returns, Dispatches, Cash Receipts) runs inside strict `prisma.$transaction` locks to guarantee atomic ledger and inventory consistency.

---

## Quick Launch Procedure (Daily Operations)

Once the application is installed on your Server PC, day-to-day operations require no technical knowledge.

### Windows Daily Launch & Shutdown

#### To Start:
1. Double-click **`start.bat`** (or your **Paper Trade** Desktop Shortcut).
2. The launcher will automatically:
   - Check that **Docker Desktop** is running. If not, it politely alerts you to open Docker Desktop first.
   - Start the PostgreSQL database and Next.js web application containers.
   - Actively poll `http://localhost:3000` until the web server is online.
   - Automatically open your default web browser to the login page (`http://localhost:3000`).

#### To Stop:
1. Double-click **`stop.bat`** (or your **Stop Paper Trade** Desktop Shortcut).
2. Containers stop gracefully, ensuring all database transactions are safely committed to disk and system RAM/ports are freed.

---

### Linux Daily Launch & Shutdown

#### To Start:
Open a terminal in the project directory (or double-click your desktop launcher) and run:
```bash
./start.sh
```
The script checks the Docker service, starts the Compose stack in detached mode, polls `http://localhost:3000`, and opens your default browser via `xdg-open`.

#### To Stop:
```bash
./stop.sh
```
Cleanly stops containers and unbinds network ports.

---

## Setup Guide on a New Device (First-Time Setup)

Follow the instructions below depending on whether your Server PC runs Windows or Linux.

---

### Option A: Windows Setup (Windows 10 / 11)

#### Step 1: Install Docker Desktop for Windows
1. Download **Docker Desktop for Windows**:
   [https://www.docker.com/products/docker-desktop/](https://www.docker.com/products/docker-desktop/)
2. Run the installer (`Docker Desktop Installer.exe`).
3. Ensure the option **"Use WSL 2 instead of Hyper-V (recommended)"** is checked.
4. Restart your computer when prompted.
5. Open Docker Desktop from the Start menu. Wait 30–60 seconds until the whale icon in your taskbar system tray (bottom-right) turns green and shows **"Engine running"**.

> **BIOS Virtualization Note**: If Docker Desktop reports that hardware virtualization is disabled, enter your PC BIOS/UEFI settings and enable **Intel Virtualization Technology (VT-x)** or **AMD-V**.

#### Step 2: Copy Project Files
Place the project folder in a clean path on your hard drive, for example:
`C:\PaperTrade`

#### Step 3: Configure Environment
Open **Command Prompt** (`cmd`) inside `C:\PaperTrade`:
```cmd
cd /d C:\PaperTrade
copy .env.example .env
```
*(Optional: Open `.env` in Notepad to adjust your business name, contact phone, or owner credentials).*

#### Step 4: Build Application Image & Launch Containers
```cmd
docker compose build app
docker compose up -d
```
*The initial build compiles the Next.js standalone package inside Alpine Linux. This takes approximately 2–3 minutes.*

#### Step 5: Initialize Database (Migrations & Seed Data)
Execute these two one-time commands to create the database schema and populate initial catalog items:
```cmd
# 1. Apply schema migrations
docker compose exec app npx prisma migrate deploy

# 2. Seed initial paper categories, qualities, and default owner account
docker compose exec app npx prisma db seed
```

#### Step 6: Log In
Open your browser to: **`http://localhost:3000`**
- **Email:** `owner@example.com` (or value from `.env`)
- **Password:** `ChangeMe123!`

---

### Option B: Linux Setup (Ubuntu / Debian / Fedora / Arch)

#### Step 1: Install Docker & Docker Compose
On Ubuntu / Debian:
```bash
# 1. Update package lists
sudo apt update

# 2. Install Docker and Compose plugin
sudo apt install -y docker.io docker-compose-v2 curl

# 3. Enable and start Docker daemon
sudo systemctl enable --now docker

# 4. Add your current user to the docker group (avoids needing sudo)
sudo usermod -aG docker $USER

# 5. Apply new group membership (or log out and log back in)
newgrp docker
```

On Fedora:
```bash
sudo dnf install -y docker docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
newgrp docker
```

On Arch Linux:
```bash
sudo pacman -S docker docker-compose
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
newgrp docker
```

#### Step 2: Copy Project Files
Copy the project folder to your desired location, e.g.:
`~/PaperTrade`

#### Step 3: Configure Environment & Script Permissions
```bash
cd ~/PaperTrade
cp .env.example .env

# Ensure shell scripts have execute permissions
chmod +x start.sh stop.sh scripts/*.sh
```

#### Step 4: Build Application Image & Launch Containers
```bash
docker compose build app
docker compose up -d
```

#### Step 5: Initialize Database (Migrations & Seed Data)
```bash
# 1. Apply schema migrations
docker compose exec app npx prisma migrate deploy

# 2. Seed initial paper categories, qualities, and default owner account
docker compose exec app npx prisma db seed
```

#### Step 6: Log In
Open your browser to: **`http://localhost:3000`**
- **Email:** `owner@example.com`
- **Password:** `ChangeMe123!`

---

## Desktop Shortcut Setup

### Windows Desktop Shortcut

1. Open File Explorer and browse to your project folder (e.g. `C:\PaperTrade`).
2. Right-click **`start.bat`** -> select **Send to** -> **Desktop (create shortcut)**.
   *(On Windows 11, click **Show more options** first).*
3. Go to your Desktop, right-click the shortcut, and select **Properties**:
   - **Target:** `C:\PaperTrade\start.bat`
   - **Start in:** `C:\PaperTrade` *(CRITICAL: must point to project root so Compose files are found).*
   - **Run:** Set to **Normal window** *(ensures status and startup messages are visible).*
   - **Change Icon:** Click **Change Icon...**, type `%SystemRoot%\System32\shell32.dll`, and pick a business icon.
4. Rename the shortcut to **Paper Trade ERP**.
5. Repeat for **`stop.bat`** and name it **Stop Paper Trade** for easy end-of-day shutdown.

---

### Linux Application Launcher (.desktop)

You can create a desktop launcher on Ubuntu or any Linux desktop environment:

1. Create a launcher file on your desktop:
   ```bash
   nano ~/Desktop/papertrade.desktop
   ```
2. Paste the following configuration (replace `/path/to/project` with your actual project directory path):
   ```ini
   [Desktop Entry]
   Version=1.0
   Type=Application
   Name=Paper Trade ERP
   Comment=Start Paper Trade Management System
   Exec=/path/to/project/start.sh
   Path=/path/to/project
   Icon=accessories-calculator
   Terminal=true
   Categories=Office;Finance;
   ```
3. Make the launcher executable:
   ```bash
   chmod +x ~/Desktop/papertrade.desktop
   ```
4. On Ubuntu/GNOME, right-click the desktop icon and select **"Allow Launching"**.

---

## Local Area Network (LAN) Multi-PC Access

Multiple client PCs (billing counters, warehouse operators, manager laptops) can access the system simultaneously without installing Docker or Node.js.

### Finding Server IP Address

#### On Windows Server PC:
1. Press `Win + R`, type `cmd`, and press Enter.
2. Type `ipconfig` and look for the **IPv4 Address** under **Ethernet adapter Ethernet** (e.g., `192.168.1.50`).

#### On Linux Server PC:
In your terminal, run:
```bash
hostname -I | awk '{print $1}'
# or
ip addr show | grep 'inet ' | grep -v '127.0.0.1'
```

> **Network Tip**: For a stable setup, assign a **Static IP** to the Server PC in your office router settings (DHCP Reservation) so the IP address remains constant every day.

---

### Configuring the Firewall

#### On Windows Server PC:
Windows Firewall may block incoming requests from other computers on the LAN. Allow port 3000 by opening **Command Prompt as Administrator** and running:
```cmd
netsh advfirewall firewall add rule name="PaperBusinessApp" dir=in action=allow protocol=TCP localport=3000
```

#### On Linux Server PC:
If UFW (Uncomplicated Firewall) is enabled, allow incoming traffic on port 3000:
```bash
sudo ufw allow 3000/tcp
```

---

### Connecting from Client Workstations

On any secondary PC, laptop, or tablet connected to the same office network (LAN cable or Wi-Fi):
1. Open Google Chrome, Microsoft Edge, or Mozilla Firefox.
2. In the URL address bar, enter:
   ```text
   http://192.168.1.50:3000
   ```
   *(Replace `192.168.1.50` with the actual IP address of the Server PC).*
3. The Paper Trade login screen will appear immediately. Staff can log in with their assigned accounts.

---

## Database Backup & Restore Operations

Protecting your customer balances, stock transactions, and ledger entries is essential.

### Method 1: Instant In-App Backup & Restore
1. Log into the application as an **OWNER**.
2. Navigate to **Settings** in the left sidebar.
3. Under **Database Backup & Restore**:
   - **To Backup:** Click **"Backup Database Now (.sql)"**. A timestamped `.sql` snapshot will immediately download through your browser. Copy this file onto a USB thumb drive.
   - **To Restore:** Select your `.sql` file in the restore section, check the confirmation box, and click **"Confirm & Restore Database"**.

### Method 2: Automated Nightly Backups

#### Windows Task Scheduler:
1. Press `Win + R`, type `taskschd.msc`, and press Enter.
2. Click **Create Basic Task...**
   - **Name:** `Paper Trade Nightly Backup`
   - **Trigger:** Daily at `20:00` (8:00 PM)
   - **Action:** Start a program
   - **Program/script:** `C:\PaperTrade\scripts\backup.bat`
   - **Start in:** `C:\PaperTrade`
3. Click **Finish**.

#### Linux Cron Job:
Open your user crontab:
```bash
crontab -e
```
Add the following line to back up daily at 8:00 PM:
```bash
0 20 * * * /path/to/project/scripts/backup.sh >> /path/to/project/backups/backup.log 2>&1
```

### Method 3: Manual Script Execution
- **Windows:** Run `scripts\backup.bat` to back up, or drag a `.sql` file onto `scripts\restore.bat`.
- **Linux:** Run `./scripts/backup.sh` to back up, or `./scripts/restore.sh backups/your_snapshot.sql` to restore.

---

## Troubleshooting & Diagnostics

| Symptom | Operating System | Diagnostic Step | Solution |
| :--- | :--- | :--- | :--- |
| Launcher says Docker is not running | **Windows** | Whale icon in system tray is grey or missing. | Open Docker Desktop from Start menu. Wait for the green "Engine running" status. |
| Launcher says Docker is not running | **Linux** | `systemctl is-active docker` returns inactive. | Run `sudo systemctl start docker`. Ensure user is in docker group (`sudo usermod -aG docker $USER`). |
| Port 3000 is already in use | **Windows** | Run `netstat -ano \| findstr :3000` | Terminate conflicting process in Task Manager or change host port in `docker-compose.yml`. |
| Port 3000 is already in use | **Linux** | Run `sudo ss -tulpn \| grep 3000` | Identify PID using port 3000 and stop it (`kill <PID>`). |
| Client PC cannot connect over LAN | **Both** | Ping server IP from client: `ping <SERVER-IP>` | Verify both PCs are on the same subnet. Verify Windows Firewall rule (`netsh advfirewall...`) or Linux UFW (`sudo ufw allow 3000/tcp`). |
| Standalone App won't start | **Both** | Run `docker compose logs app` | Check for configuration errors in `.env`. Rebuild container with `docker compose build app`. |
| Database won't start | **Both** | Run `docker compose logs db` | Check available disk space on server drive. Check volume permissions. |

---

## Developer Conventions & Maintenance

### Line Endings Policy (`.gitattributes`)
To prevent cross-platform script corruption:
- `*.bat` and `*.cmd` files are strictly enforced with **CRLF** line endings.
- `*.sh`, source code (`*.ts`, `*.tsx`, `*.js`), and config files are enforced with **LF** line endings.

### Useful Maintenance Commands
```bash
# Check container status and health
docker compose ps

# View real-time application logs
docker compose logs -f app

# View database logs
docker compose logs -f db

# Restart services
docker compose restart

# Clean shutdown
docker compose down
```

---

## License & Support
Paper Trade Management System is built for private commercial deployment. All rights reserved.
