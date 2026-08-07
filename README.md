# AI Customer Service System
We transform customer support from a cost center into a strategic asset.

Most AI solutions are simple chatbots that offer generic, scripted answers. We build autonomous, agentic AI that understands intent, remembers context, and executes workflows across your entire business stack—delivering the speed of AI with the precision and reliability of a human expert.

# What we Solve
Businesses today are drowning in high-volume, low-complexity support tickets that drain human energy and slow down growth [1.3.1]. Our platform solves this by:
- Eliminating bottlenecks: Automating routine tasks (order status, account updates, FAQs) 24/7 without needing to scale your headcount
- Context-Aware Resolution: Unlike basic bots, our agents possess "episodic memory," remembering past interactions to deliver hyper-personalized support
- Safe Autonomy: Through a unique "Multi-Agent" validation architecture, we ensure accuracy, minimize hallucinations, and guarantee seamless handoffs to human agents whenever complex judgment is required

# How it Works
- Reasoning & Planning: Our agents don't just "chat"—they break down complex, multi-step customer requests into logical, actionable plans
- Tool-Use Integration: We connect the AI directly to your CRM, order management systems, and knowledge bases to execute real-time actions, not just provide information
- Data-Driven Reliability: By utilizing RAG (Retrieval-Augmented Generation) and structured Markdown knowledge bases, our agents respond only based on your verified, up-to-date company data

# Key Features
- Omnichannel Consistency: A unified experience across WhatsApp, SMS, Email, and Voice
- Human-in-the-Loop: A native "Critic" pattern that monitors agent output, ensures compliance, and manages safe escalations to human reps with full interaction history
- Scalable Efficiency: Built for rapid deployment in high-volume enterprise environments

# Technical Guideline

The platform supports two automation engines for routing Telegram (and other
channel) messages into the AI engine:

| Engine | Start command | Port | Notes |
|--------|---------------|------|-------|
| **n8n** | `docker run ... n8n` | 5678 | Original workflow engine |
| **Activepieces** | `npx -y activepieces` | 3001 | No Docker required — avoids Docker freeze |

> ⚠️ If `docker` freezes on your machine, use the **Activepieces** path. It runs
> entirely via `npx` (Node.js) with local SQLite/file storage, no Docker needed.

## Installs
**Requirements:** ngrok, nodejs, python, and **either** docker+n8n **or** just nodejs (for Activepieces)

### Option A — n8n (Docker)
```
docker run -it --rm -p 5678:5678 -v "C:\Users\Himaska\.n8n:/home/node/.n8n" --name n8n docker.n8n.io/n8nio/n8n
```
Then import `api/n8n-extension-workflow.json` into n8n.

### Option B — Activepieces (no Docker, recommended if Docker freezes)
```
npx -y activepieces
```
Activepieces starts on `http://localhost:3001`. On first run it will download
its packages; subsequent runs are faster. Data is stored locally in `./ap_data`.

## Running the Platform

### One-command launcher (manager.py)
The easiest way to run everything is the manager script:
```
python manager.py install          # installs frontend + API deps
python manager.py run --platform activepieces   # starts Activepieces + all services
python manager.py run --platform n8n             # starts n8n-style (ngrok → 5678)
```

### Manual startup
**Frontend**
Go to frontend folder.
```
cd frontend
npm install
npm run dev
```
**API**
Go to API folder.
```
cd api
python -m venv venv
venv\scripts\activate.ps1
python -m pip install -r requirements.txt
```
**Starting python files**
There are 2 files. `company-api` is the simulated third-party side communicating with our platform. `main` is our platform.
```
python -m uvicorn main:app --reload
python -m company-api
python -m extension
ngrok http 5678          # for n8n
# OR
ngrok http 8001          # for activepieces (extension service)
```

## Connecting to Activepieces
Once Activepieces is running on `http://localhost:3001` and the extension
service is on `http://localhost:8001`:

1. **Check connectivity:**
   ```
   curl http://localhost:8001/activepieces/status
   ```
2. **Deploy the Telegram routing flow** (from `api/activepieces-flow.json`):
   ```
   curl -X POST http://localhost:8001/activepieces/deploy -H "Content-Type: application/json" -d "{\"publish\": true}"
   ```
   This also upserts a Telegram bot connection using the `TELEGRAM_TOKEN` from `api/.env`.
3. **List flows / connections:**
   ```
   curl http://localhost:8001/activepieces/flows
   curl http://localhost:8001/activepieces/connections
   ```
4. **Enable / disable / delete a flow:**
   ```
   curl -X POST http://localhost:8001/activepieces/flows/<id>/enable
   curl -X POST http://localhost:8001/activepieces/flows/<id>/disable
   curl -X DELETE http://localhost:8001/activepieces/flows/<id>
   ```

### Activepieces environment variables (`api/.env`)
| Variable | Default | Description |
|----------|---------|-------------|
| `ACTIVEPIECES_URL` | `http://localhost:3001` | Activepieces instance URL |
| `ACTIVEPIECES_API_KEY` | _(empty)_ | API key from Activepieces UI (Settings → API Keys) |
| `ACTIVEPIECES_TIMEOUT` | `15` | Request timeout in seconds |
| `AI_ENGINE_URL` | `http://localhost:8001` | URL the Activepieces flow calls back into |

# Ports Used
```
npm run dev (frontend)        -> port 3000
main (the AI engine)          -> port 8000
extension (webhook/dispatch)  -> port 8001
company (company side)        -> port 8002
n8n (optional)                -> port 5678
activepieces (no Docker)      -> port 3001