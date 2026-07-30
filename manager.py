import subprocess
import sys
import os
import time
import argparse

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

def run_app():
    print("🚀 --- RUNNING SERVICES ---")
    processes = []
    api_dir, python_path, _ = get_venv_paths()
    frontend_dir = os.path.join(os.getcwd(), "frontend")

    try:
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
        print("🌍 Starting Ngrok tunnel (port 5678)...")
        p_ngrok = subprocess.Popen("ngrok http 5678", shell=True)
        processes.append(p_ngrok)

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
    
    args = parser.parse_args()
    
    if args.action == "install":
        install_packages()
    elif args.action == "run":
        run_app()