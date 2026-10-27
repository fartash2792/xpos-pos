# XPOS – Smart Multi-Business POS (offline-first)

A complete, offline-first point-of-sale and accounting system for **retail, wholesale, pharmacy, bakery, clothing and mobile shops**. Built as a clone/improvement of "XPOS – Smart Multi-Business POS". The default currency is PKR (Rs), and you can change it.

- **Backend:** Node.js + Express + Knex. SQLite by default (better-sqlite3); Postgres (Neon / Render) via `DATABASE_URL`; MySQL with one `.env` switch. JWT auth, bcrypt passwords, migrations + seed.
- **Frontend:** React 18 + Vite PWA (service-worker app shell), Dexie/IndexedDB local database, Tailwind CSS. Responsive, with a dark mode.
- **One process:** the Express server also serves the built frontend.

**Default login:** `admin@xpos.local` / `admin123`, POS PIN `1234`

---

## Quick start (local)

```bash
# Node 18+ (tested on Node 22)
npm run setup        # installs server + frontend, builds frontend, migrates and seeds the DB
npm start            # http://localhost:3000
```

Run the steps one at a time if you prefer:

```bash
npm --prefix server install && npm --prefix frontend install
npm run build        # frontend -> frontend/dist (served by the server)
npm run migrate      # creates server/data/xpos.sqlite
npm run seed         # demo business + admin user + sample products/customers/stock
npm start
```

`npm start` runs pending migrations automatically and, on a database with no users at all, seeds the demo business (disable with `SEED_DEMO=false`). It listens on `PORT` (default 3000).

Development with hot reload: run `npm run dev:server` (port 3000) and `npm run dev:frontend` (port 5173, proxies `/api`).

API smoke test: `npm test` boots its own in-process server on a random port against whichever database your env selects (SQLite by default; set `DATABASE_URL` to test Postgres). To test an already-running server instead: `BASE=http://localhost:3000 npm test`. It covers 27 checks: login, product create, sync push/pull, stock, invoice numbering, LWW, permissions, balanced books and tenant isolation.

---

## Features

| Module | What's included |
|---|---|
| **Auth & users** | Sign-up with a business profile step (name, type, opening cash balance, phone, address, currency). Login, roles (Owner / Manager / Cashier) with permissions enforced in the UI and on the server, user management, per-user 4-digit POS PIN, change password, **offline login**. |
| **Dashboard** | Today's and month's sales, gross and net profit, purchases, expenses, receivable/payable, cash & bank, 14-day sales chart, top products, low-stock alerts, recent sales. |
| **POS counter** | PIN gate, search plus barcode/SKU/IMEI scanner input (keyboard-wedge scanners: scan, then Enter), category filter, retail/wholesale price mode, cart with per-line qty, price, discount and tax. Invoice discount (amount or %), order tax and shipping. Hold/resume, quotations. Payments: cash, card, bank (account selectable), JazzCash, Easypaisa, credit/due, loyalty points, **split payment** and change calculation. Customer select + quick add. Variant picker (size/colour), IMEI picker, automatic FEFO batch selection. Thermal receipts (58/80 mm) and A4 invoices. |
| **Sales & returns** | Invoice list with filters, CSV export, invoice detail, reprint, partial returns (refund by any method or adjust the customer balance). Stock and serials are restored and returns post to the books. |
| **Products / inventory** | SKU/barcode (with generator), category, brand, unit, cost/retail/wholesale price, tax, low-stock alert. **Variants** (size/colour, each with its own SKU/barcode/price/stock), **batch & expiry** (pharmacy), **IMEI/serial** tracking (mobile shops). Opening stock, stock adjustments, multi-branch stock view, branch transfers, movement history, expiry tracking, low-stock **reorder suggestions** (30-day sales velocity), barcode label printing (Code128), CSV import/export. |
| **Purchases** | Suppliers, purchase orders (then *Receive*), purchase invoices with batch/expiry and IMEI entry, landed cost (discount and freight spread), optional cost-price update, partial payment, purchase returns. |
| **Parties** | Customers and suppliers with opening balances, credit limits (over-limit flag), ledgers with running balance and a printable statement, receive/pay payments, loyalty points. |
| **Accounts** | Chart of accounts (add bank/wallet/expense accounts), cash & bank balances, transfers. Every sale, return, purchase, expense, income, payment, adjustment and register difference auto-posts a **double-entry journal**. You also get a manual journal, day book, **trial balance, profit & loss and balance sheet** (balance checks shown), plus a **cash register** (open/close shift with expected vs counted cash, optional over/short posting, and a Z-report). |
| **Expenses & income** | Categories (each mapped to an expense account), payment account, deletion by reversing entry, CSV export. |
| **Reports** | Sales by day, product, category, cashier, customer and payment method. Purchases by supplier, stock & valuation (cost and retail), expiry, profit, tax (output vs input), customer dues and supplier dues. Date filters, print and CSV. |
| **Settings** | Business info and logo, currency code/symbol, NTN, invoice prefix/header/footer, receipt size (58/80/A4), default tax, tax rates, branches/warehouses, categories/brands/units, POS PIN requirement, negative-stock rule, loyalty rules, users, JSON backup/restore, full re-sync, audit log. |
| **Improvements** | Audit log of every change, customer loyalty points (earn and redeem), quotations you can convert to sales, reorder suggestions, dark mode, multi-branch with a branch switcher, installable PWA. |

---

## How offline sync works

1. **Local first.** Every record has a client-generated UUID, `business_id`, `updated_at` (ms) and `deleted` (soft delete). Every write goes into IndexedDB (Dexie) **and** an `outbox` table in the same transaction, so the UI never waits for the network.
2. **Push.** When the browser is online and `GET /api/health` answers (checked on the `online` event, every 30 s, 1.5 s after any local write, or with **Sync now**), the outbox is sent in batches to `POST /api/sync/push`. The server applies each record with **last-write-wins on `updated_at`**. If its copy is newer, it returns the server version as a conflict and the client stores it. An outbox entry is cleared only if the record wasn't edited again while the push was in flight.
3. **Pull.** `GET /api/sync/pull?since=<cursor>` returns every record whose server sequence number is greater than the cursor. A global, monotonically increasing `seq` is assigned in the push transaction, so the cursor doesn't depend on device clocks. Results come in windows of 2,000 with `has_more`. Records still pending in the local outbox are not overwritten.
4. **Stock is never a stored number.** Each sale, purchase, return, adjustment and transfer writes `stock_movements` rows (+/- qty per product/variant/branch/batch), and stock = the sum of movements. Two devices selling offline both add their own movements, so nothing is overwritten. Re-pushing the same records is idempotent because the IDs are the same.
5. **Invoice numbers.** Offline sales get a device-prefixed number such as `7F3A-0012` (the prefix comes from a per-device ID). On sync, the server assigns the final sequential number (`INV-000123`, using the prefix from Settings) and never changes it afterwards. Quotations get `QT-00001` the same way.
6. **Accounting offline.** Journal entries are built in the browser by the same shared code the server uses (`shared/posting.js`). Each entry is balanced on its own, so the books stay balanced however records arrive.
7. **Offline login & PIN.** After one online login, the device keeps a salted SHA-256 hash of the credentials and the JWT (valid 30 days), so the same email/password works offline. The POS counter has a 4-digit PIN (default `1234`), checked locally against the synced PIN hash. A PIN changed offline is pushed when the device reconnects.
8. **Indicator.** The header shows Online/Offline, the number of pending changes, the last sync time, a **Sync now** button and any sync error (for example, an expired session).

---

## Standalone offline demo (no server)

`npm run build:standalone` builds `frontend/dist-standalone/`, a local-only version that seeds demo data into the browser's IndexedDB. Log in with `admin@xpos.local` / `admin123`. Serve the folder with any static server (`npx serve frontend/dist-standalone` or `python3 -m http.server`). Browsers block ES modules on `file://`, so double-clicking `index.html` won't work. After the first load it works fully offline (service worker). Sign-up and server user management are disabled in this mode.

---

## Deploy to Render + Neon (free tier)

The repo ships a `render.yaml` Blueprint: one free Node web service. On start it migrates the database and, if it has no users yet, creates the demo business, so there's nothing to run by hand.

1. **Create the database.**
   - *Neon (recommended, free Postgres that doesn't expire):* sign up at [neon.tech](https://neon.tech), create a project, and copy the connection string from **Connection details** (looks like `postgresql://user:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require`). The pooled (`-pooler`) host works too.
   - *Or Render Postgres:* **New → Postgres → Free**, then copy the **External** (or Internal, if same region) Database URL. Note Render's free Postgres expires after 30 days.
2. **Push this repo to GitHub/GitLab** (`git remote add origin … && git push -u origin main`).
3. In Render: **New → Blueprint**, pick the repo. Render reads `render.yaml` and asks for `DATABASE_URL`: paste the connection string from step 1. `JWT_SECRET` is generated for you, and `NODE_VERSION` is pinned to 22.
4. Deploy. Build runs `npm run install:all && npm run build`; start runs `npm start`; Render checks `/api/health`.
5. Open `https://<your-service>.onrender.com`, log in with `admin@xpos.local` / `admin123`, and **change the password immediately** (Settings → Users → Edit). Or set `SEED_DEMO=false` before the first deploy and use **Sign up** to create your own business.

Environment variables used:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string. Its presence switches the server to Postgres (or set `DB_CLIENT=pg`). |
| `DATABASE_SSL` | TLS is on by default (`rejectUnauthorized: false`, which Neon/Render need). Set `false` only for a local Postgres without TLS. |
| `JWT_SECRET` | Signs login tokens. Must stay stable across restarts or everyone gets logged out. |
| `PORT` | Set by Render automatically. |
| `SEED_DEMO` | `false` to skip creating the demo business on an empty database. |
| `DB_POOL_MAX` | Postgres pool size (default 5, or 2 on Vercel; keep low on free plans). |

Free-tier notes:
- The free web service sleeps after ~15 minutes idle; the first request afterwards takes 30–60 s to wake. The PWA keeps working offline on devices and syncs once the server is awake.
- Render's filesystem is ephemeral, so **don't use SQLite on Render**; all data lives in Postgres.
- Local Postgres for testing: `DATABASE_URL=postgres://user:pass@localhost:5432/xpos DATABASE_SSL=false npm test`.

## Deploy to Vercel + Neon (free, serverless)

Vercel's free Hobby plan serves the built PWA from its CDN and runs the API as one serverless function (`api/index.js`), which wraps the same Express app the Node server uses. Data lives in Neon Postgres. SQLite isn't available here: the function refuses to start without `DATABASE_URL`.

What the repo already contains:
- `vercel.json`: installs with `npm run install:all`, builds with `npm run build`, publishes `frontend/dist`, rewrites `/api/*` to the function and everything else to `index.html`, and sends `sw.js`, `workbox-*.js`, `manifest.webmanifest` and `index.html` with `max-age=0, must-revalidate` so service-worker updates reach devices. Hashed files in `/assets` are cached for a year.
- `api/index.js`: on each cold start it runs pending migrations and, on an empty database, seeds the demo business, once, before the first request. Concurrent cold starts are serialized with a Postgres advisory lock, so nothing runs twice.
- Node 22 (`"engines": { "node": "22.x" }` in the root `package.json`).

### Steps

1. **Neon:** create a project at [neon.tech](https://neon.tech). Under **Connection details**, turn on **Connection pooling** and copy the **pooled** string (the host contains `-pooler`), e.g. `postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require`. Pick a Neon region close to your Vercel function region (Vercel's default is `iad1`, Washington DC, which matches Neon's `us-east-1`).
2. **Vercel, from the dashboard:** **Add New → Project**, import the GitHub repo, keep the framework preset as **Other** (the settings come from `vercel.json`), add the environment variables below, then **Deploy**.
3. **Or from the CLI**, at the repo root with a token from *Account Settings → Tokens*:

   ```bash
   export VERCEL_TOKEN=...            # never commit this
   npx vercel link --yes --token $VERCEL_TOKEN          # first time: creates/links the project
   printf '%s' "$DATABASE_URL" | npx vercel env add DATABASE_URL production --token $VERCEL_TOKEN
   printf '%s' "$(openssl rand -hex 32)" | npx vercel env add JWT_SECRET production --token $VERCEL_TOKEN
   npx vercel deploy --prod --yes --token $VERCEL_TOKEN
   ```

4. Open `https://<project>.vercel.app`, log in with `admin@xpos.local` / `admin123`, and **change the password right away**. Or set `SEED_DEMO=false` before the first deploy and use **Sign up**.

| Variable | Required | Value |
|---|---|---|
| `DATABASE_URL` | yes | Neon **pooled** connection string. `sslmode`/`channel_binding` params are fine (TLS is handled by the server). |
| `JWT_SECRET` | yes | A long random string (`openssl rand -hex 32`). It must stay the same between deploys or everyone gets logged out. |
| `SEED_DEMO` | no | `false` to skip the demo business on an empty database. |
| `DB_POOL_MAX` | no | Connections per function instance (default 2 on Vercel). |

Notes:
- The first request after a while idle is a cold start (about 1–3 s; a little longer the very first time, while tables are created). Neon's free compute also sleeps after 5 minutes idle and wakes on the next query. The PWA keeps working offline either way and syncs when the API answers.
- Hobby limits: the function's max duration is set to 30 s, and request bodies are capped at 4.5 MB by Vercel. Very large backup restores or sync pushes over that size fail on Vercel; the client pushes in batches, so normal syncing is well under it.
- Local check of the Vercel setup without a Vercel account: `npm run build`, then `DATABASE_URL=... JWT_SECRET=... node scripts/vercel-local.mjs` (serves `frontend/dist` with the `vercel.json` headers and SPA fallback, and sends `/api/*` to `api/index.js` on port 3100). Then run `BASE=http://127.0.0.1:3100 npm test`.

## Deploy to a VPS (Ubuntu + pm2 + nginx)

```bash
sudo apt install -y nginx && curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
sudo npm i -g pm2
git clone <your repo> /var/www/xpos   # or upload and unzip xpos-clone.zip
cd /var/www/xpos
cp server/.env.example server/.env && nano server/.env   # set JWT_SECRET (long random string), PORT=3000
npm run setup
pm2 start ecosystem.config.cjs && pm2 save && pm2 startup
```

nginx site (`/etc/nginx/sites-available/xpos`):

```nginx
server {
  server_name pos.example.com;
  client_max_body_size 25m;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/xpos /etc/nginx/sites-enabled/ && sudo nginx -t && sudo systemctl reload nginx
sudo apt install -y certbot python3-certbot-nginx && sudo certbot --nginx -d pos.example.com
```

**Use HTTPS.** Service workers (offline app shell / install as an app) need HTTPS, or `localhost`. Updating: `git pull && npm run setup && pm2 restart xpos`.

## Deploy to cPanel ("Setup Node.js App")

1. Upload `xpos-clone.zip` to your home directory (e.g. `~/xpos`) and extract it.
2. Build the frontend **on your PC** (`npm --prefix frontend install && npm run build`) and upload `frontend/dist/`. Many shared hosts can't run Vite.
3. In cPanel go to **Setup Node.js App**, then **Create Application**: Node 18+, *Application root* `xpos/server`, *Application URL* your domain or a sub-path, *Startup file* `app.js`.
4. Click **Run NPM Install** (installs `server/package.json`).
5. Add environment variables in the app screen: `JWT_SECRET`, and the MySQL settings (recommended on cPanel, see below). Create the MySQL database and user under **MySQL Databases**.
6. Open the app's terminal (*Enter to the virtual environment* command shown in cPanel) and run `npm run migrate && npm run seed`, then **Restart**.
7. The app uses relative URLs and hash routing, so it works under a sub-path (e.g. `example.com/pos`) without rewrite rules.

If `better-sqlite3` can't compile on your host, use MySQL. It's pure JavaScript (`mysql2`), and passwords use `bcryptjs`, so no native build is needed.

## Switching to Postgres

```ini
# server/.env
DATABASE_URL=postgres://xpos:secret@127.0.0.1:5432/xpos
DATABASE_SSL=false   # omit for hosted Postgres (Neon, Render, Supabase)
```

BIGINT/NUMERIC columns are parsed to JS numbers, invoice/quotation counters use an atomic `INSERT … ON CONFLICT … RETURNING`, and the sync sequence uses `UPDATE … RETURNING`, so concurrent devices get unique numbers.

## Switching to MySQL

```ini
# server/.env
DB_CLIENT=mysql2
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=xpos
DB_PASSWORD=secret
DB_NAME=xpos
```

```sql
CREATE DATABASE xpos CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'xpos'@'%' IDENTIFIED BY 'secret'; GRANT ALL ON xpos.* TO 'xpos'@'%';
```

Then run `npm run migrate && npm run seed && npm start`. The schema is identical: one table per entity (`id`, `business_id`, `data` JSON as MEDIUMTEXT, `updated_at`, `deleted`, `seq`, `device_id`), plus `businesses`, `users`, `counters` and `sync_state`. To move existing data, use **Settings → Backup & restore**: export JSON from the old install, then import into the new one (or just let devices push their local data).

---

## Project layout

```
shared/        business logic used by BOTH browser and server
  posting.js   cart math, sales/returns/purchases/payments/expenses → records + balanced journals; stock helpers
  accounts.js  default chart of accounts, payment methods
  seed.js      new-business starter data and demo data
  entities.js  list of synced entities; permissions.js roles
server/
  src/index.js Express app (auth, users, sync, REST /api/data/:entity, /api/pos/sale, reports, static frontend)
  src/store.js LWW upsert, sequence allocation, invoice numbering, pull windows
  migrations/  Knex migrations     scripts/ migrate, seed, smoke-test
  app.js       entry file for cPanel/Passenger
api/index.js   Vercel serverless function (wraps the Express app; migrate + seed once per cold start)
vercel.json    Vercel build, rewrites and cache headers     scripts/vercel-local.mjs  local Vercel stand-in
frontend/
  src/lib/     db.js (Dexie + outbox), sync.js (engine), session.js (online/offline auth, PIN), receipt.js
  src/pages/   Dashboard, POS, Sales, Quotations, Products, Inventory, Purchases, Parties, Accounts, Expenses, Shifts, Reports, Settings
tests/         Playwright browser E2E scripts (optional; need `npm i playwright`)
```

## API overview

- `POST /api/auth/signup`, `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/pin`, `POST /api/auth/password`
- `GET|POST|PUT|DELETE /api/users` (owner)
- `POST /api/sync/push` `{device_id, changes:[{entity, record}]}` returns `{applied, conflicts, rejected, assigned}`
- `GET /api/sync/pull?since=N` returns `{changes:{entity:[...]}, cursor, has_more}`
- `GET|POST /api/data/:entity`, `GET|DELETE /api/data/:entity/:id` (generic REST over every entity)
- `POST /api/pos/sale` `{items, invoice, payments, warehouse_id}` (server-side sale using the same posting logic)
- `GET /api/reports/stock`, `GET /api/reports/trial-balance`

## Notes & limitations

- Most reports are calculated in the browser from IndexedDB, so they also work offline. This is fine for typical shop volumes (tens of thousands of invoices). Very large datasets would benefit from server-side report endpoints.
- Record-level last-write-wins: if two devices edit the *same* product field offline, the later edit wins. Sales, stock and payments are append-only records, so they never conflict.
- Users are created and edited on the server (online). Every other operation works offline.
- A product is either variant-based or not. For variant products, add stock via a purchase or an adjustment.
