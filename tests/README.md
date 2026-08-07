# CI/CD Test Suite

This folder contains automated tests for the customer service agent platform.

## Test Accounts

### Allianz Account (hamazaki)
- **Email**: hamazaki.ethanlin@gmail.com
- **Password**: et123456789
- **Purpose**: Testing task detection and AI functionality

### SenecaAI Account (himaska)
- **Email**: himaska.ethanlin@gmail.com
- **Password**: et123456789
- **Purpose**: Testing tenant isolation

## Test Suites

### 1. Drag & Drop Tests (`tests/drag-drop/`)
Tests the workflow editor's drag-and-drop functionality:
- Adding nodes to canvas
- Removing nodes from canvas
- Re-adding removed nodes
- Connecting nodes
- Saving workflow configurations

### 2. Task Detection Tests (`tests/task-detection/`)
Tests AI task detection capabilities:
- Send messages that should trigger tasks
- Verify tasks are detected correctly
- Test with Allianz account (hamazaki)
- Validate task execution

### 3. Tenant Isolation Tests (`tests/tenant-isolation/`)
Tests multi-tenant data isolation:
- Login as hamazaki (Allianz)
- Verify data access
- Login as himaska (SenecaAI)
- Ensure no cross-tenant data access
- Test concurrent sessions

## Running Tests

```bash
# Run all tests
npm run test:ci

# Run specific test suite
npm run test:dragdrop
npm run test:tasks
npm run test:tenants

# Run with coverage
npm run test:coverage
```

## CI/CD Integration

Tests automatically run on:
- Pull requests to main
- Pushes to main
- Daily scheduled runs

See `.github/workflows/test-pipeline.yml` for CI configuration.