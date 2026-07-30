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
## Installs
**Requirements:** ngrok, docker, n8n, nodejs, python
```
docker run -it --rm -p 5678:5678 -v "C:\Users\Himaska\.n8n:/home/node/.n8n" --name n8n docker.n8n.io/n8nio/n8n
```

## Running the Platform
Run the following commands.
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
**Starting python file**
There are 2 files. `company-api` is the simulated third-party side communicating with our platform. `main` is our platform.
```
python -m uvicorn main:app --reload
python -m company-api
python -m extension
ngrok http 5678
```

# Ports Used
```
npm run dev -> port 3000
main (the AI engine) -> port 8000
company (company side for tasks) -> port 8001
extensions -> port 8002
```