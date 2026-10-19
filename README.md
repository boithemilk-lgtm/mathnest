# MathNest 🪺 — a math site with a secret

**MathNest** looks like a plain homework-helper website: topic explainers, formula
references, a practice quiz. But type **`67`** into the search bar and press
Enter, and the search bar drops you straight into **THE VAULT** — a neon gaming
hideout with HTML5 games, a live chatroom with accounts, a built-in web proxy,
and more.

## Features

### The disguise (`/`)
- Clean, credible math-help site: 12 topic explainers, formula reference cards,
  and a 5-question practice quiz with scoring.
- Search bar that behaves like a normal site search — except for the magic word.

### THE VAULT (`/vault.html`)
- **6 built-in HTML5 games** (pure canvas + WebAudio, no libraries):
  - 🐍 **Neon Snake** — grid snake with speed levels
  - 🔢 **2048** — tile merging with swipe + arrow keys
  - 🧱 **Brick Breaker** — paddle + ball + levels
  - 🐦 **Flappy One** — one-tap flying
  - 🏓 **Pong vs Machine** — first to 7
  - 🧩 **Blockfall** — falling-block stacker
- **Online chatroom** — username/password signup (PBKDF2-SHA256 hashed
  passwords, 30k iterations), sessions, live messages (2s polling), and an
  "online now" list. Chat renders with `textContent` only — XSS-safe by
  construction.
- **Built-in proxy** — type any URL and pages are fetched server-side,
  rewritten so navigation stays inside the proxy, and rendered in a sandboxed
  iframe (CSP-sandboxed, isolated from this app's storage). Private/internal
  addresses are blocked at the connection level (validated DNS), responses
  are capped at 5 MB (including decompressed size) and a best-effort 12 s
  upstream timeout. Best for simple informational sites.
- **Extras** — drum pad, hacker typer, fun facts, sound effects, best scores.

## Run locally

```bash
npm install   # no dependencies — this is a no-op
npm start     # serves on http://localhost:3000
```

No build step, no dependencies. Node 18+.

## Deploy to Wasmer

This app targets [Wasmer Edge](https://wasmer.io) (Node.js apps are
auto-detected from `package.json` — no `wasmer.toml` needed). It is
**Wasmer-configured, not Wasmer-tested**: it was built and verified locally
and on a static host, and the Wasmer deployment itself is yours to run.
Report any Edge-specific quirks you hit.

### Option A: GitHub connection (recommended)
1. Push this repo to GitHub.
2. On https://wasmer.io, open **Apps → New App** (or an existing app) →
   **Git settings → GitHub provider → authorize**.
3. Select the repo and the `main` branch. Every push to `main` redeploys
   automatically, built remotely.

### Option B: Wasmer CLI
```bash
wasmer login
wasmer deploy --non-interactive --build-remote
```

### Before deploying
Edit `app.yaml`:

```yaml
owner: YOUR_WASMER_USERNAME   # ← change me
name: mathnest
package: .
volumes:
  - name: data
    mount: /data
```

The `data` volume is required — it persists the JSON database (accounts,
chat messages) across redeploys. **Note:** removing or renaming the volume in
`app.yaml` deletes that data.

### GitHub Actions (optional, manual)
A deploy workflow is included at `.github/workflows/deploy.yml` — it only
runs when triggered manually from the Actions tab (the dashboard Git
connection is the recommended path). To use it:
1. Create a Wasmer access token at https://wasmer.io/settings/access-tokens
2. Add it as a repository secret named `WASMER_TOKEN`
3. Actions tab → "Deploy to Wasmer Edge (manual)" → Run workflow

## Project structure

```
├── app.yaml            # Wasmer Edge app config (owner + volume)
├── package.json        # zero deps, start script
├── src/
│   ├── server.js       # http server: static files + API + proxy
│   ├── sha256.js       # pure-JS SHA-256 / HMAC / PBKDF2 (QuickJS-safe)
│   ├── store.js        # JSON store with atomic writes (/data/db.json)
│   ├── auth.js         # signup/login/sessions/presence/messages
│   └── proxy.js        # server-side fetch proxy with HTML rewriting
└── public/
    ├── index.html      # MathNest (the disguise)
    ├── vault.html      # THE VAULT (the games)
    ├── css/            # math.css, vault.css
    └── js/             # math.js, api.js, vault.js, games/*.js
```

## Notes & limits

- The proxy works best for simple, informational sites. Destinations that
  need cookies, logins, or heavy JavaScript may partially break — pages are
  rewritten and sandboxed on purpose. Responses are capped at 5 MB and 12
  seconds (enforced incrementally at the connection level), and private/
  internal addresses (including DNS names that resolve to them) are blocked.
- Chat messages are capped at the most recent 500.
- The JSON store serializes writes with a cross-process lock. If a process
  crashes mid-write, mutations return "Server is busy" until you stop all
  instances and delete `<data>/db.json.lock` — the lock is never auto-deleted.
- Passwords are never stored in plain text; sessions are 30-day bearer tokens.
- `VAULT_API_BASE` (optional): if you serve the frontend from a different
  origin than the backend, set `window.VAULT_API_BASE` before `js/api.js`
  loads.

## License

MIT — see [LICENSE](LICENSE).
