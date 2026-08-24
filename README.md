# Ledger — Personal Finance Tracker

A free, local-first income/expense dashboard: multi-account tracking,
budgets, savings goals, recurring transactions, CSV import/export, receipt
scanning, and charts. All data is stored in your browser's IndexedDB —
nothing leaves your machine except receipt photos, which go straight to
Claude's API when you choose to scan one.

## Run it locally

```bash
npm install
npm run dev
```

Then open the URL it prints (usually http://localhost:5173).

## Receipt scanning setup (optional)

Click the gear icon in the top bar and paste in a Claude API key (from
console.anthropic.com). It's stored only in your browser's localStorage.
Then use "Scan receipt" to photograph or upload a receipt — Claude Haiku
4.5 reads the merchant, total, date, and category, and pre-fills a new
ledger entry for you to review before saving.

Cost is roughly ₹0.20 per scan (well under ₹1 even with heavy use) — see
the pricing breakdown in chat if you want the full math.

## Build for deployment (still free)

```bash
npm run build
```

This produces a `dist/` folder you can deploy for free on Vercel, Netlify,
or GitHub Pages — same as the Chocoza app. Note: if you deploy this
publicly, anyone using your deployed site would need to enter their own
API key too — the key never leaves the browser it's entered in.

## Notes

- Data lives in the browser's IndexedDB (via Dexie). Clearing your browser's
  site data will erase it — use Export CSV for backups.
- Currency is formatted in INR (₹). To change this, edit `fmtINR` in `src/App.jsx`.
- Recurring entries are checked and auto-logged each time the app loads.
