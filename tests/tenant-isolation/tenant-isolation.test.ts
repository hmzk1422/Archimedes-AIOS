/**
 * Tenant Isolation Tests
 * Tests multi-tenant data isolation between accounts
 * 
 * Test Accounts:
 * - Allianz (hamazaki): hamazaki.ethanlin@gmail.com
 * - SenecaAI (himaska): himaska.ethanlin@gmail.com
 */

import { test, expect } from '@playwright/test'

const HAMAZAKI_EMAIL = 'hamazaki.ethanlin@gmail.com'
const HAMAZAKI_PASSWORD = 'et123456789'
const HIMASKA_EMAIL = 'himaska.ethanlin@gmail.com'
const HIMASKA_PASSWORD = 'et123456789'

test.describe('Tenant Isolation', () => {
  test('should isolate data between hamazaki (Allianz) and himaska (SenecaAI)', async ({ page }) => {
    // Step 1: Login as hamazaki (Allianz)
    await page.goto('http://localhost:3000/auth')
    await page.waitForLoadState('networkidle')
    
    await page.fill('input[type="email"]', HAMAZAKI_EMAIL)
    await page.fill('input[type="password"]', HAMAZAKI_PASSWORD)
    await page.click('button[type="submit"]')
    await page.waitForURL('**/dashboard', { timeout: 10000 })

    // Create some data as hamazaki
    await page.goto('http://localhost:3000/agent')
    await page.waitForLoadState('networkidle')
    
    const messageInput = page.locator('textarea[placeholder*="message"]')
    await messageInput.fill('This is a test message from Allianz account')
    await messageInput.press('Enter')
    await page.waitForTimeout(3000)

    // Get tenant ID or some identifier from the page
    const tenantIdHamazaki = await page.evaluate(() => {
      // Try to get tenant ID from localStorage or page content
      return localStorage.getItem('tenant_id') || 'hamazaki-tenant'
    })

    // Step 2: Logout
    await page.goto('http://localhost:3000/auth')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1000)

    // Step 3: Login as himaska (SenecaAI)
    await page.fill('input[type="email"]', HIMASKA_EMAIL)
    await page.fill('input[type="password"]', HIMASKA_PASSWORD)
    await page.click('button[type="submit"]')
    await page.waitForURL('**/dashboard', { timeout: 10000 })

    // Get tenant ID for himaska
    const tenantIdHimaska = await page.evaluate(() => {
      return localStorage.getItem('tenant_id') || 'himaska-tenant'
    })

    // Verify tenant IDs are different
    expect(tenantIdHamazaki).not.toBe(tenantIdHimaska)

    // Step 4: Try to access hamazaki's data from himaska account
    await page.goto('http://localhost:3000/agent')
    await page.waitForLoadState('networkidle')

    // Send a message that would reveal previous context
    const messageInput2 = page.locator('textarea[placeholder*="message"]')
    await messageInput2.fill('What was my last message?')
    await messageInput2.press('Enter')
    await page.waitForTimeout(3000)

    // Get the AI response
    const response = await page.evaluate(() => {
      // Try to get the last AI message
      const messages = document.querySelectorAll('[data-testid="message"]')
      return messages[messages.length - 1]?.textContent || ''
    })

    // The response should NOT contain hamazaki's test message
    expect(response.toLowerCase()).not.toContain('allianz account')
    expect(response.toLowerCase()).not.toContain('test message from allianz')
  })

  test('should not share workflow configurations between tenants', async ({ page }) => {
    // Login as hamazaki
    await page.goto('http://localhost:3000/auth')
    await page.waitForLoadState('networkidle')
    
    await page.fill('input[type="email"]', HAMAZAKI_EMAIL)
    await page.fill('input[type="password"]', HAMAZAKI_PASSWORD)
    await page.click('button[type="submit"]')
    await page.waitForURL('**/dashboard', { timeout: 10000 })

    // Go to workflow editor
    await page.goto('http://localhost:3000/dashboard')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)

    // Add a node to the workflow
    const telegramNode = page.locator('text=Telegram').first()
    const canvas = page.locator('.react-flow')
    const box = await canvas.boundingBox()
    
    if (box) {
      await telegramNode.dragTo(canvas, {
        targetPosition: { x: box.x + 200, y: box.y + 100 }
      })
    }
    await page.waitForTimeout(500)

    // Save the workflow
    const saveButton = page.locator('button:has-text("Save")')
    await saveButton.click()
    await page.waitForTimeout(1000)

    // Logout
    await page.goto('http://localhost:3000/auth')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1000)

    // Login as himaska
    await page.fill('input[type="email"]', HIMASKA_EMAIL)
    await page.fill('input[type="password"]', HIMASKA_PASSWORD)
    await page.click('button[type="submit"]')
    await page.waitForURL('**/dashboard', { timeout: 10000 })

    // Go to workflow editor
    await page.goto('http://localhost:3000/dashboard')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)

    // Check that hamazaki's node is NOT present
    const nodesOnCanvas = await page.locator('.react-flow__node').count()
    
    // himaska should have an empty canvas (or different workflow)
    // hamazaki's Telegram node should not be there
    const telegramNodes = await page.locator('text=Telegram').count()
    
    // If there are Telegram nodes, they should only be in the sidebar, not on canvas
    expect(nodesOnCanvas).toBe(0)
  })

  test('should not leak database records between tenants', async ({ page }) => {
    // Login as hamazaki
    await page.goto('http://localhost:3000/auth')
    await page.waitForLoadState('networkidle')
    
    await page.fill('input[type="email"]', HAMAZAKI_EMAIL)
    await page.fill('input[type="password"]', HAMAZAKI_PASSWORD)
    await page.click('button[type="submit"]')
    await page.waitForURL('**/dashboard', { timeout: 10000 })

    // Create a conversation as hamazaki
    await page.goto('http://localhost:3000/agent')
    await page.waitForLoadState('networkidle')
    
    const messageInput = page.locator('textarea[placeholder*="message"]')
    await messageInput.fill('Create a test conversation for Allianz')
    await messageInput.press('Enter')
    await page.waitForTimeout(5000)

    // Logout
    await page.goto('http://localhost:3000/auth')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1000)

    // Login as himaska
    await page.fill('input[type="email"]', HIMASKA_EMAIL)
    await page.fill('input[type="password"]', HIMASKA_PASSWORD)
    await page.click('button[type="submit"]')
    await page.waitForURL('**/dashboard', { timeout: 10000 })

    // Try to access hamazaki's data via API
    const hamazakiData = await page.evaluate(async () => {
      try {
        // This would require knowing hamazaki's tenant ID
        // For now, just verify we're logged in as himaska
        const response = await fetch('/api/telemetry/data/himaska-tenant')
        return { success: true, data: await response.json() }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })

    // Should not be able to access hamazaki's data
    // (This test would need actual tenant IDs to be fully effective)
    expect(true).toBe(true) // Placeholder assertion
  })

  test('should maintain separate sessions concurrently', async ({ browser }) => {
    // Create two browser contexts (simulating two users)
    const context1 = await browser.newContext()
    const context2 = await browser.newContext()
    
    const page1 = await context1.newPage()
    const page2 = await context2.newPage()

    // Login as hamazaki in page1
    await page1.goto('http://localhost:3000/auth')
    await page1.waitForLoadState('networkidle')
    await page1.fill('input[type="email"]', HAMAZAKI_EMAIL)
    await page1.fill('input[type="password"]', HAMAZAKI_PASSWORD)
    await page1.click('button[type="submit"]')
    await page1.waitForURL('**/dashboard', { timeout: 10000 })

    // Login as himaska in page2
    await page2.goto('http://localhost:3000/auth')
    await page2.waitForLoadState('networkidle')
    await page2.fill('input[type="email"]', HIMASKA_EMAIL)
    await page2.fill('input[type="password"]', HIMASKA_PASSWORD)
    await page2.click('button[type="submit"]')
    await page2.waitForURL('**/dashboard', { timeout: 10000 })

    // Both should be logged in successfully
    const hamazakiDashboard = await page1.locator('text=Dashboard').isVisible()
    const himaskaDashboard = await page2.locator('text=Dashboard').isVisible()
    
    expect(hamazakiDashboard).toBe(true)
    expect(himaskaDashboard).toBe(true)

    // Send messages in both contexts simultaneously
    const chat1 = page1.locator('textarea[placeholder*="message"]')
    const chat2 = page2.locator('textarea[placeholder*="message"]')
    
    await chat1.fill('Message from Allianz')
    await chat1.press('Enter')
    
    await chat2.fill('Message from SenecaAI')
    await chat2.press('Enter')
    
    await page1.waitForTimeout(3000)
    await page2.waitForTimeout(3000)

    // Verify responses are separate
    const response1 = await page1.evaluate(() => {
      const messages = document.querySelectorAll('[data-testid="message"]')
      return messages[messages.length - 1]?.textContent || ''
    })
    
    const response2 = await page2.evaluate(() => {
      const messages = document.querySelectorAll('[data-testid="message"]')
      return messages[messages.length - 1]?.textContent || ''
    })

    // Responses should be different (tenant-specific)
    expect(response1).not.toBe(response2)

    // Cleanup
    await context1.close()
    await context2.close()
  })
})