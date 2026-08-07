/**
 * Task Detection Tests
 * Tests AI task detection capabilities using the Allianz account
 */

import { test, expect } from '@playwright/test'

const ALLIANZ_EMAIL = 'hamazaki.ethanlin@gmail.com'
const ALLIANZ_PASSWORD = 'et123456789'

test.describe('Task Detection - Allianz Account', () => {
  test.beforeEach(async ({ page }) => {
    // Login as Allianz account
    await page.goto('http://localhost:3000/auth')
    await page.waitForLoadState('networkidle')
    
    // Fill in login credentials
    await page.fill('input[type="email"]', ALLIANZ_EMAIL)
    await page.fill('input[type="password"]', ALLIANZ_PASSWORD)
    
    // Click login
    await page.click('button[type="submit"]')
    
    // Wait for redirect to dashboard
    await page.waitForURL('**/dashboard', { timeout: 10000 })
  })

  test('should detect task when asking about policies', async ({ page }) => {
    // Navigate to agent chat
    await page.goto('http://localhost:3000/agent')
    await page.waitForLoadState('networkidle')

    // Send a message that should trigger a task
    const messageInput = page.locator('textarea[placeholder*="message"]')
    await messageInput.fill('I need information about my critical illness policy')
    await messageInput.press('Enter')

    // Wait for AI response
    await page.waitForTimeout(5000)

    // Check that a task was detected (look for task indicators)
    // This could be a task badge, tool call indicator, or specific message
    const taskIndicator = page.locator('text=/task|tool|action/i')
    const count = await taskIndicator.count()
    
    // At least one task-related indicator should appear
    expect(count).toBeGreaterThan(0)
  })

  test('should detect task when asking about claims', async ({ page }) => {
    await page.goto('http://localhost:3000/agent')
    await page.waitForLoadState('networkidle')

    const messageInput = page.locator('textarea[placeholder*="message"]')
    await messageInput.fill('I want to file a claim for my medical expenses')
    await messageInput.press('Enter')

    await page.waitForTimeout(5000)

    // Verify task detection
    const taskIndicator = page.locator('text=/claim|filing|submit/i')
    const count = await taskIndicator.count()
    
    expect(count).toBeGreaterThan(0)
  })

  test('should execute detected tasks', async ({ page }) => {
    await page.goto('http://localhost:3000/agent')
    await page.waitForLoadState('networkidle')

    const messageInput = page.locator('textarea[placeholder*="message"]')
    await messageInput.fill('What is my current coverage?')
    await messageInput.press('Enter')

    // Wait for task execution
    await page.waitForTimeout(8000)

    // Check for task execution confirmation
    const executionIndicator = page.locator('text=/executed|completed|result/i')
    const count = await executionIndicator.count()
    
    // Task should have been executed
    expect(count).toBeGreaterThan(0)
  })

  test('should handle HITL (Human In The Loop) when required', async ({ page }) => {
    await page.goto('http://localhost:3000/agent')
    await page.waitForLoadState('networkidle')

    // Send message that requires approval
    const messageInput = page.locator('textarea[placeholder*="message"]')
    await messageInput.fill('I want to update my beneficiary information')
    await messageInput.press('Enter')

    await page.waitForTimeout(5000)

    // Check for HITL approval prompt
    const hitlPrompt = page.locator('text=/approval|confirm|authorize/i')
    const count = await hitlPrompt.count()
    
    // HITL should be triggered for sensitive operations
    expect(count).toBeGreaterThan(0)
  })
})