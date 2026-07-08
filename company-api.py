# company_api.py
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import uvicorn

app = FastAPI(title="Allianz Mock API")

# --- 1. The "Company Database" ---
MOCK_DATABASE = {
    "claims": {
        "CLM-123": {"status": "Pending", "reason": "Awaiting Police Report"},
        "CLM-999": {"status": "Approved", "reason": "Funds dispatched to bank account"}
    },
    "policies": {
        "POL-001": {"balance": 5000.00}
    }
}

# --- 2. Data Models (For POST requests) ---
class TopUpRequest(BaseModel):
    amount: float

class ClaimRegistration(BaseModel):
    incident_date: str
    has_all_docs: bool

# --- 3. The API Endpoints ---
@app.get("/api/claims/{claim_id}")
def get_claim(claim_id: str):
    """Simulates a GET request to fetch claim data."""
    claim_id = claim_id.upper()
    if claim_id not in MOCK_DATABASE["claims"]:
        raise HTTPException(status_code=404, detail="Claim ID not found.")
    return MOCK_DATABASE["claims"][claim_id]

@app.post("/api/policies/{policy_id}/top-up")
def process_top_up(policy_id: str, request: TopUpRequest):
    """Simulates a POST request to add money to a policy."""
    # In a real app, you'd update the database here
    return {"message": f"SUCCESS: Top-up of ${request.amount} initiated for Policy #{policy_id}."}

@app.post("/api/claims/register")
def register_claim(request: ClaimRegistration):
    """Simulates a POST request to register a new claim."""
    return {"message": "SUCCESS: Claim details registered in the database.", "data": request.dict()}

if __name__ == "__main__":
    print("Starting Company API Simulation on port 8000...")
    uvicorn.run(app, host="127.0.0.1", port=8000)