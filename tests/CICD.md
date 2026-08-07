# CI/CD Pipeline Documentation

## Overview

This CI/CD pipeline automatically tests the customer service agent platform to ensure:
1. **Drag & Drop functionality** works correctly
2. **Task detection** operates properly (using Allianz test account)
3. **Tenant isolation** prevents data bleeding between accounts

## Test Accounts

### Allianz Account (hamazaki)
- **Email**: `hamazaki.ethanlin@gmail.com`
- **Password**: `et123456789`
- **Used for**: Task detection tests

### SenecaAI Account (himaska)
- **Email**: `himaska.ethanlin@gmail.com`
- **Password**: `et123456789`
- **Used for**: Tenant isolation tests

## Pipeline Structure

### Job 1: Test Suite (Matrix Strategy)
Runs three test suites in parallel:
- **drag-drop**: Tests workflow editor functionality
- **task-detection**: Tests AI task detection with Allianz account
- **tenant-isolation**: Tests multi-tenant data isolation

### Job 2: Tenant Isolation Check
Additional verification that tenant data is properly isolated at the API level.

### Job 3: Notify
Sends notifications on test failures.

## Running Tests Locally

### Prerequisites
```bash
# Install dependencies
npm install
cd tests && npm install
cd ../api && pip install -r requirements.txt
```

### Start Services
```bash
# Terminal 1: Start main API
cd api
uvicorn main:app --host 0.0.0.0 --port 8000

# Terminal 2: Start extension API
cd api
uvicorn extension:app --host 0.0.0.0 --port 8001

# Terminal 3: Start frontend
cd frontend
npm run dev
```

### Run Tests
```bash
# Run all tests
cd tests
npm run test:ci

# Run specific test suite
npm run test:dragdrop      # Drag & drop tests
npm run test:tasks         # Task detection tests
npm run test:tenants       # Tenant isolation tests

# Run with coverage
npm run test:coverage
```

## Test Details

### 1. Drag & Drop Tests (`tests/drag-drop/`)
Tests the React Flow workflow editor:
- ✅ Editor loads with sidebar
- ✅ Nodes available in sidebar
- ✅ Drag node to canvas
- ✅ Connect two nodes
- ✅ Delete selected node
- ✅ Save workflow configuration
- ✅ Re-add removed node

### 2. Task Detection Tests (`tests/task-detection/`)
Tests AI task detection with Allianz account:
- ✅ Detect task when asking about policies
- ✅ Detect task when asking about claims
- ✅ Execute detected tasks
- ✅ Handle HITL (Human In The Loop) when required

### 3. Tenant Isolation Tests (`tests/tenant-isolation/`)
Tests multi-tenant data isolation:
- ✅ Data isolation between hamazaki and himaska
- ✅ Workflow configurations not shared between tenants
- ✅ Database records not leaked between tenants
- ✅ Separate concurrent sessions maintained

## CI/CD Configuration

### GitHub Actions Workflow
File: `.github/workflows/test-pipeline.yml`

**Triggers**:
- Pull requests to `main`
- Pushes to `main`
- Daily scheduled runs (2 AM UTC)

**Secrets Required**:
- `SUPABASE_URL`: Supabase project URL
- `SUPADB_API`: Supabase API key
- `HAMAZAKI_EMAIL`: Allianz test account email
- `HAMAZAKI_PASSWORD`: Allianz test account password
- `HIMASKA_EMAIL`: SenecaAI test account email
- `HIMASKA_PASSWORD`: SenecaAI test account password

## Coverage Requirements

- **Branches**: 70%
- **Functions**: 70%
- **Lines**: 70%
- **Statements**: 70%

## Troubleshooting

### Tests fail with "connection refused"
Ensure all services are running:
```bash
# Check if services are up
curl http://localhost:8000/health
curl http://localhost:8001/health
curl http://localhost:3000
```

### Playwright browsers not installed
```bash
cd tests
npx playwright install chromium
```

### Tenant isolation test fails
Verify test accounts exist in Supabase:
- hamazaki.ethanlin@gmail.com
- himaska.ethanlin@gmail.com

## Adding New Tests

### Drag & Drop Test
```typescript
// tests/drag-drop/workflow-editor.test.ts
test('should do something new', async ({ page }) => {
  // Your test code
})
```

### Task Detection Test
```typescript
// tests/task-detection/task-detection.test.ts
test('should detect new task type', async ({ page }) => {
  // Your test code
})
```

### Tenant Isolation Test
```typescript
// tests/tenant-isolation/tenant-isolation.test.ts
test('should isolate new data type', async ({ page }) => {
  // Your test code
})
```

## Monitoring

### View Test Results
1. Go to GitHub repository
2. Click "Actions" tab
3. Select the latest workflow run
4. View test results and artifacts

### Download Artifacts
Test results are uploaded as artifacts and retained for 30 days:
- Screenshots on failure
- Test logs
- Coverage reports

## Maintenance

### Updating Test Accounts
If test account credentials change, update:
1. `tests/README.md`
2. `tests/task-detection/task-detection.test.ts`
3. `tests/tenant-isolation/tenant-isolation.test.ts`
4. `.github/workflows/test-pipeline.yml` (secrets)

### Adding New Test Suites
1. Create new folder in `tests/`
2. Add test files with `.test.ts` extension
3. Update `tests/package.json` with new script
4. Update `.github/workflows/test-pipeline.yml` matrix

## Security Notes

- Test credentials are stored as GitHub Secrets
- Never commit actual passwords to git
- Test data is isolated from production data
- Tenant isolation tests prevent data leakage