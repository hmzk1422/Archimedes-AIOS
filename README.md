# Archimedees-aios

Archimedees-aios is an enterprise AI operating system for creating and managing tenant-isolated AI agents. It provides workspaces, role-based access control (RBAC), a visual workflow builder, and cloud-hosted services. Agent integrations run through n8n or Activepieces. The current example connects a Telegram bot to an AI agent.

## Requirements

- Python 3.11+
- Node.js 20+ and npm/npx
- Supabase project credentials
- ngrok for exposing the webhook service to Telegram and Activepieces
- Activepieces (default) or n8n (optional)

## Configure environment

Create or update `api/.env`:

```dotenv
# Supabase
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPADB_API=YOUR_SUPABASE_SERVICE_OR_SECRET_KEY

# Telegram bot token from BotFather
TELEGRAM_TOKEN=YOUR_TELEGRAM_BOT_TOKEN

# Activepieces API settings
ACTIVEPIECES_URL=http://localhost:3001
ACTIVEPIECES_API_KEY=YOUR_ACTIVEPIECES_API_KEY
ACTIVEPIECES_TIMEOUT=15

# Public URL for the extension API (ngrok forwards port 8001)
AI_ENGINE_URL=https://YOUR_NGROK_DOMAIN

# Main AI endpoint used by the extension service
AI_ENDPOINT_URL=http://localhost:8000/workflow/execute

# Optional model and email settings used by the AI and human-approval features
GOOGLE_API_KEY=YOUR_GOOGLE_AI_API_KEY
LLAMA_CLOUD_API_KEY=YOUR_LLAMA_CLOUD_API_KEY
SMTP_HOST=YOUR_SMTP_HOST
SMTP_PORT=587
SMTP_USER=YOUR_SMTP_USERNAME
SMTP_PASS=YOUR_SMTP_PASSWORD
SMTP_FROM=YOUR_SENDER_ADDRESS
```

Create `frontend/.env.local` with the Supabase project URL and public anon key used by the web app:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_PUBLIC_ANON_KEY
NEXT_PUBLIC_API_URL=http://localhost:8001
```

Get an Activepieces API key from **Settings → API Keys** in Activepieces. Set `AI_ENGINE_URL` to the public ngrok URL forwarding to port `8001`; Activepieces must be able to reach this URL to send Telegram messages to the agent.

## Commands

```sh
python manager.py install                       # Install frontend and API dependencies
python manager.py start                         # Master command: start Activepieces, APIs, frontend, and ngrok
python manager.py start --platform n8n          # Start the platform using n8n instead
```

The default launcher starts the web app on port `3000`, the AI API on `8000`, the extension/webhook API on `8001`, Activepieces on `3001`, and the company demo API on `8002`. Press Ctrl+C in the launcher terminal to stop the services.

## Activepieces and Telegram

1. Before startup, set `ACTIVEPIECES_URL`, `ACTIVEPIECES_API_KEY`, and `TELEGRAM_TOKEN` in `api/.env`. The Activepieces key comes from **Settings → API Keys** at `http://localhost:3001` after its first launch; restart the platform after adding the key.
2. Start the platform with `python manager.py start`. Set `AI_ENGINE_URL` to the public ngrok URL forwarding to port `8001`, then open `http://localhost:3001`.
3. Check the Activepieces connection and deploy the Telegram workflow:

```sh
curl http://localhost:8001/activepieces/status
curl -X POST http://localhost:8001/activepieces/deploy \
  -H "Content-Type: application/json" \
  -d '{"publish":true}'
```

4. Configure the Telegram connection and agent workflow in the workspace at `http://localhost:3000`.

## Activepieces commands

```sh
curl http://localhost:8001/activepieces/flows                 # List deployed flows
curl http://localhost:8001/activepieces/connections           # List saved connections
curl -X POST http://localhost:8001/activepieces/flows/FLOW_ID/enable  # Enable a flow
curl -X POST http://localhost:8001/activepieces/flows/FLOW_ID/disable # Disable a flow
curl -X DELETE http://localhost:8001/activepieces/flows/FLOW_ID       # Delete a flow
```

## Manual startup

Use these commands instead of the master launcher when you need to start services individually:

```sh
cd frontend
npm install
npm run dev
```

```sh
cd api
python -m venv venv
# Windows: .\venv\Scripts\Activate.ps1
# macOS/Linux: source venv/bin/activate
python -m pip install -r requirements.txt
python -m uvicorn main:app --reload --port 8000
python -m uvicorn extension:app --reload --port 8001
python -m uvicorn company-api:app --reload --port 8002
```

Run Activepieces independently with:

```sh
npx -y activepieces
```

For n8n, start n8n on port `5678`, import `api/n8n-extension-workflow.json`, and run `python manager.py start --platform n8n` for the remaining services.
