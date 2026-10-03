# Paper Trade — Business Management System

A local-first ERP and accounting platform designed specifically for paper merchants, paper converters, and warehouse distributors.

Runs natively on **Windows** (with multi-PC LAN access) or via **Docker** on Linux. Zero cloud subscriptions required.

---

## Highlights

- **Inventory & Lot Tracking**: Shared warehouse, retail shop, real-time stock balances, custom lot batch costing.
- **Partnership Hub**: Multi-partner inventory pooling, capital injection tracking, automatic equity profit splits, settlement logs.
- **Commercial Billing**: Sales invoices, delivery orders, purchase orders, purchase returns, and customer walk-ins.
- **Double-Entry Ledgers**: Customer receivables, supplier payables, partner capital balances, expense tracking, and real-time P&L.
- **Automated Dual Backup**: Daily 4:00 PM local backups (3-rotation archive in `C:\PaperTradeBackups\local`) + Google Drive cloud sync (`papertrade_backup:PaperTradeBackup`).
- **Multi-Workstation LAN**: One host PC runs the system; multiple counter, billing, and warehouse PCs connect via browser over office Wi-Fi or LAN cable.

---

## Quick Start (Daily Operations)

### Starting the System
- **Windows**: Double-click **`start.bat`** (or your desktop shortcut).
  - Starts the PostgreSQL connection and application server.
  - Automatically opens **`http://localhost:3000`** in your default web browser.
- **Linux / Docker**: Run `./start.sh`

### Stopping the System
- **Windows**: Double-click **`stop.bat`** (or your desktop shortcut).
  - Safely terminates background node processes and releases port 3000.
- **Linux / Docker**: Run `./stop.sh`

### Default Login Credentials
- **URL**: `http://localhost:3000`
- **Email**: `admin@admin.com`
- **Password**: `admin123!`
*(Credentials can be updated anytime in the application under User Management).*

---

## Multi-PC Access Over Office LAN

Any computer, laptop, or tablet on your office network can access the system without installing software:

1. **Find Server IP**: On the host server PC, open Command Prompt and type `ipconfig`. Find your IPv4 address (e.g. `192.168.1.50`).
2. **Open Firewall Port 3000** (Run once in Command Prompt as Administrator):
   ```cmd
   netsh advfirewall firewall add rule name="PaperTrade" dir=in action=allow protocol=TCP localport=3000
   ```
3. **Connect from Workstations**: Open Chrome, Edge, or Firefox on any counter PC and navigate to:
   ```
   http://192.168.1.50:3000
   ```
   *(Replace with your server PC's actual IP address).*

---

## Automated Backup System

Paper Trade includes an automated local and cloud backup system:

| Layer | Destination | Schedule / Policy |
| :--- | :--- | :--- |
| **Local Backup** | `C:\PaperTradeBackups\local\` | Automatic 3-rotation retention (keeps 3 newest `.dump` files) |
| **Cloud Sync** | `papertrade_backup:PaperTradeBackup` | Synced to Google Drive via rclone (`daily_latest.dump`) |
| **Execution Log** | `C:\PaperTradeBackups\backup_execution.log` | Records dump timestamp, size, tables, and cloud sync status |

### Setup in 1-Click:
Run Command Prompt as Administrator and execute:
```cmd
scripts\register-backup-task.bat
```
This registers a daily task in Windows Task Scheduler set to run **`scripts\run_backup.bat`** every day at **4:00 PM**.

### Manual On-Demand Backup:
- **From App**: Go to **Settings** → click **"Backup Database Now (.dump)"**.
- **From Script**: Double-click `scripts\run_backup.bat`.

---

## Project Structure & Key Scripts

```
PaperTrade/
├── scripts/
│   ├── run_backup.bat             # Automated local backup + Google Drive sync script
│   ├── register-backup-task.bat   # 1-click Windows Task Scheduler registration (4:00 PM daily)
│   ├── backup.bat                 # Manual local backup trigger
│   ├── restore.bat                # Database restore utility
│   └── rclone.exe                 # Cloud sync binary
├── src/
│   ├── actions/                   # Server actions (sales, purchases, partnerships, ledger)
│   ├── app/                       # Next.js App Router UI pages & modals
│   └── lib/                       # Stock engine, ledger logic, auth, db client
├── prisma/
│   └── schema.prisma              # Database models (PostgreSQL)
├── start.bat                      # 1-click launcher for Windows
├── stop.bat                       # 1-click shutdown script
├── update.bat                     # Code update & migration script
├── SETUP.md                       # Comprehensive installation and setup manual
└── README.md                      # Overview & quick operations guide
```

---

## Need Full Installation Instructions?

For step-by-step initial deployment on a brand new Windows PC (PostgreSQL installation, database creation, environment configuration, and rclone Google Drive setup), see the complete guide:

👉 [**Read SETUP.md**](SETUP.md)

---

## License & Support

Paper Trade Business Management System is designed for private commercial deployment. All rights reserved.
