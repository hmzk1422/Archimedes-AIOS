// Test setup file
import { config } from 'dotenv'

// Load environment variables
config({ path: '../api/.env' })

// Global test configuration
global.fetch = jest.fn()

// Mock console methods to reduce noise
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}

// Test timeout
jest.setTimeout(30000)

// Cleanup after each test
afterEach(() => {
  jest.clearAllMocks()
})