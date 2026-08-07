import subprocess
import sys
import os
import time
import argparse
import shutil


def is_tool_available(name: str) -> bool:
    """Check whether a CLI tool is available on PATH."""
    return shutil.which(name) is not None


def get_venv_paths():
    """Returns the correct paths to pip and python inside the venv depending on OS."""
    root_dir = os.getcwd()
    api_dir = os.path.join(root_dir, "api")
    
    # Windows uses 'Scripts', Linux/Termux uses 'bin'
    if os.name == 'nt':
        python_path = os.path.join(api_dir, "venv", "Scripts", "python.exe")
        pip_path = os.path.join(api_dir, "venv", "Scripts", "pip.exe")
    else:
        python_path = os.path.join(api_dir, "venv", "bin", "python")
        pip_path = os.path.join(api_dir, "venv", "bin", "pip")
        
    return api_dir, python_path, pip_path

def install_packages():
    print("📦 --- INSTALLING PACKAGES ---")
    api_dir, python_path, pip_path = get_venv_paths()
    
    # 1. Frontend Setup
    print("\n🌐 Installing Frontend dependencies (npm install)...")
    if os.path.exists("frontend"):
        subprocess.run("npm install", shell=True, cwd="frontend")
    else:
        print("⚠️ 'frontend' directory not found!")

    # 2. API Setup
    print("\n🐍 Setting up Python Virtual Environment...")
    if os.path.exists("api"):
        # Create venv if it doesn't exist
        subprocess.run([sys.executable, "-m", "venv", "venv"], cwd=api_dir)
        
        print("📦 Installing API dependencies (pip install -r requirements.txt)...")
        # Install requirements using the venv's pip
        subprocess.run([pip_path, "install", "-r", "requirements.txt"], cwd=api_dir)
    else:
        print("⚠️ 'api' directory not found!")
    
    print("\n✅ Install complete! You can now run the app.")

def start_activepieces():
    """
    Start Activepieces via npx (no Docker) to avoid the Docker freeze issue.
    Activepieces runs on port 3001 by default and uses a local SQLite + file
    storage for dev mode.
    """
    print("🧩 Starting Activepieces via npx (no Docker)...")

    if not is_tool_available("npx"):
        print("⚠️ 'npx' not found on PATH. Install Node.js first (https://nodejs.org).")
        return None

    # Activepieces dev mode stores data in ./ap_data by default.
    # We run it in the project root so the data persists alongside the project.
    ap_env = os.environ.copy()
    ap_env.setdefault("AP_PORT", "3001")
    ap_env.setdefault("AP_NODE_MODE", "dev")

    p_ap = subprocess.Popen(
        "npx -y activepieces",
        shell=True,
        cwd=os.getcwd(),
        env=ap_env,
    )
    print("✅ Activepieces starting on http://localhost:3001 (first run may take a while to download).")
    return p_ap


def run_app(platform="n8n"):
    print("🚀 --- RUNNING SERVICES ---")
    processes = []
    api_dir, python_path, _ = get_venv_paths()
    frontend_dir = os.path.join(os.getcwd(), "frontend")

    # Determine which port to expose based on platform
    if platform == "activepieces":
        ngrok_port = "8001"  # Extension service port for activepieces
        print(f"🔀 Platform mode: ACTIVEPIECES (ngrok → port {ngrok_port})")
    else:
        ngrok_port = "5678"  # n8n default port
        print(f"🔀 Platform mode: N8N (ngrok → port {ngrok_port})")

    try:
        # 0. Start Activepieces (only in activepieces mode, no Docker)
        if platform == "activepieces":
            p_ap = start_activepieces()
            if p_ap:
                processes.append(p_ap)
                # Give Activepieces a moment to boot before we start ngrok
                print("⏳ Waiting 10s for Activepieces to initialize...")
                time.sleep(10)

        # 1. Start Frontend
        if os.path.exists(frontend_dir):
            print("🌐 Starting Frontend (npm run dev)...")
            p_front = subprocess.Popen("npm run dev", shell=True, cwd=frontend_dir)
            processes.append(p_front)

        # 2. Start API Services
        if os.path.exists(api_dir) and os.path.exists(python_path):
            print("🐍 Starting Main API (Uvicorn on Port 8000)...")
            p_main = subprocess.Popen([python_path, "-m", "uvicorn", "main:app", "--reload", "--port", "8000"], cwd=api_dir)
            processes.append(p_main)

            print("🏢 Starting Company API (Port 8002)...")
            p_comp = subprocess.Popen([python_path, "company_api.py"], cwd=api_dir)
            processes.append(p_comp)
            
            # Inside manager.py
            print("🔌 Starting Extension / Webhook Service (Port 8001)...")
            p_ext = subprocess.Popen(
                [python_path, "-m", "uvicorn", "extension:app", "--host", "0.0.0.0", "--port", "8001", "--reload"], 
                cwd=api_dir
            )
            processes.append(p_ext)
        else:
            print("⚠️ API venv not found. Did you run 'python manager.py install' first?")

        # 3. Start Ngrok
        print(f"🌍 Starting Ngrok tunnel (port {ngrok_port})...")
        p_ngrok = subprocess.Popen(f"ngrok http {ngrok_port}", shell=True)
        processes.append(p_ngrok)

        if platform == "activepieces":
            print("\n✨ All services are running!")
            print("   • Activepieces UI:  http://localhost:3001")
            print("   • Extension API:     http://localhost:8001")
            print("   • AI Engine:         http://localhost:8000")
            print("   • Frontend:          http://localhost:3000")
            print("\n   Next: open http://localhost:8001/activepieces/status to verify the connection,")
            print("   then POST to http://localhost:8001/activepieces/deploy to push the Telegram flow.")
            print("\nPress Ctrl+C to stop everything.")
        else:
            print("\n✨ All services are running! Press Ctrl+C to stop everything.")
        
        # Keep the script alive so the background processes don't close
        while True:
            time.sleep(1)

    except KeyboardInterrupt:
        print("\n🛑 Shutting down all services...")
        for p in processes:
            p.terminate()
        print("👋 All services stopped safely.")
        sys.exit(0)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Shortcut to install or run the project.")
    parser.add_argument("action", choices=["install", "run"], help="Type 'install' to download dependencies or 'run' to start servers.")
    parser.add_argument("--platform", choices=["n8n", "activepieces"], default="n8n", help="Choose platform for ngrok tunnel: n8n (port 5678) or activepieces (port 8001)")
    
    args = parser.parse_args()
    
    if args.action == "install":
        install_packages()
    elif args.action == "run":
        run_app(args.platform)
