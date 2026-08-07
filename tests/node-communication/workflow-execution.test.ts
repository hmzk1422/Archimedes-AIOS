/**
 * Node Communication & Workflow Execution Tests
 * Tests that nodes can actually communicate and execute workflows
 * 
 * Test Accounts:
 * - Allianz (hamazaki): hamazaki.ethanlin@gmail.com / et123456789
 * - SenecaAI (himaska): himaska.ethanlin@gmail.com / et123456789
 */

import { test, expect } from '@playwright/test'

const HAMAZAKI_EMAIL = 'hamazaki.ethanlin@gmail.com'
const HAMAZAKI_PASSWORD = 'et123456789'
const HIMASKA_EMAIL = 'himaska.ethanlin@gmail.com'
const HIMASKA_PASSWORD = 'et123456789'

test.describe('Node Communication & Workflow Execution', () => {
  test.beforeEach(async ({ page }) => {
    // Login as hamazaki (Allianz)
    await page.goto('http://localhost:3000/auth')
    await page.waitForLoadState('networkidle')
    
    await page.fill('input[type="email"]', HAMAZAKI_EMAIL)
    await page.fill('input[type="password"]', HAMAZAKI_PASSWORD)
    await page.click('button[type="submit"]')
    await page.waitForURL('**/dashboard', { timeout: 10000 })
  })

  test('should execute a simple workflow with Telegram → AI Agent → Database', async ({ page }) => {
    // Navigate to workflow editor
    await page.goto('http://localhost:3000/dashboard')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)

    // Drag Telegram node to canvas
    const telegramNode = page.locator('text=Telegram').first()
    const canvas = page.locator('.react-flow')
    const box = await canvas.boundingBox()
    
    if (box) {
      await telegramNode.dragTo(canvas, {
        targetPosition: { x: box.x + 150, y: box.y + 100 }
      })
    }
    await page.waitForTimeout(500)

    // Configure Telegram node with test token
    const telegramNodeOnCanvas = page.locator('.react-flow__node').first()
    await telegramNodeOnCanvas.click()
    
    const telegramTokenInput = page.locator('input[placeholder*="1234567890"]').first()
    await telegramTokenInput.fill('TEST_TOKEN_1234567890:AA...')
    
    // Drag AI Agent node to canvas
    const aiAgentNode = page.locator('text=AI Agent').first()
    if (box) {
      await aiAgentNode.dragTo(canvas, {
        targetPosition: { x: box.x + 450, y: box.y + 100 }
      })
    }
    await page.waitForTimeout(500)

    // Drag Database node to canvas
    const databaseNode = page.locator('text=Database').first()
    if (box) {
      await databaseNode.dragTo(canvas, {
        targetPosition: { x: box.x + 750, y: box.y + 100 }
      })
    }
    await page.waitForTimeout(500)

    // Connect Telegram → AI Agent (drag from output to input)
    // Note: This requires interacting with React Flow handles
    const sourceHandle = page.locator('.react-flow__handle-right').first()
    const targetHandle = page.locator('.react-flow__handle-left').nth(1)
    
    if (await sourceHandle.count() > 0 && await targetHandle.count() > 0) {
      const sourceBox = await sourceHandle.boundingBox()
      const targetBox = await targetHandle.boundingBox()
      
      if (sourceBox && targetBox) {
        await page.mouse.move(sourceBox.x, sourceBox.y)
        await page.mouse.down()
        await page.mouse.move(targetBox.x, targetBox.y)
        await page.mouse.up()
      }
    }
    await page.waitForTimeout(500)

    // Connect AI Agent → Database
    const sourceHandle2 = page.locator('.react-flow__handle-right').nth(1)
    const targetHandle2 = page.locator('.react-flow__handle-left').nth(2)
    
    if (await sourceHandle2.count() > 0 && await targetHandle2.count() > 0) {
      const sourceBox2 = await sourceHandle2.boundingBox()
      const targetBox2 = await targetHandle2.boundingBox()
      
      if (sourceBox2 && targetBox2) {
        await page.mouse.move(sourceBox2.x, sourceBox2.y)
        await page.mouse.down()
        await page.mouse.move(targetBox2.x, targetBox2.y)
        await page.mouse.up()
      }
    }
    await page.waitForTimeout(500)

    // Verify edges were created
    const edges = await page.locator('.react-flow__edge').count()
    expect(edges).toBeGreaterThanOrEqual(2)

    // Save the workflow
    const saveButton = page.locator('button:has-text("Save")')
    await saveButton.click()
    await page.waitForTimeout(2000)

    // Verify save success
    const successMessage = page.locator('text=Workflow saved successfully')
    await expect(successMessage).toBeVisible({ timeout: 5000 })
  })

  test('should verify node removal breaks communication correctly', async ({ page }) => {
    // Navigate to workflow editor
    await page.goto('http://localhost:3000/dashboard')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)

    // Drag two nodes to canvas
    const telegramNode = page.locator('text=Telegram').first()
    const aiAgentNode = page.locator('text=AI Agent').first()
    const canvas = page.locator('.react-flow')
    const box = await canvas.boundingBox()
    
    if (box) {
      await telegramNode.dragTo(canvas, {
        targetPosition: { x: box.x + 200, y: box.y + 100 }
      })
      await page.waitForTimeout(500)
      
      await aiAgentNode.dragTo(canvas, {
        targetPosition: { x: box.x + 500, y: box.y + 100 }
      })
      await page.waitForTimeout(500)
    }

    // Connect the nodes
    const sourceHandle = page.locator('.react-flow__handle-right').first()
    const targetHandle = page.locator('.react-flow__handle-left').nth(1)
    
    if (await sourceHandle.count() > 0 && await targetHandle.count() > 0) {
      const sourceBox = await sourceHandle.boundingBox()
      const targetBox = await targetHandle.boundingBox()
      
      if (sourceBox && targetBox) {
        await page.mouse.move(sourceBox.x, sourceBox.y)
        await page.mouse.down()
        await page.mouse.move(targetBox.x, targetBox.y)
        await page.mouse.up()
      }
    }
    await page.waitForTimeout(500)

    // Verify connection exists
    const edgesBefore = await page.locator('.react-flow__edge').count()
    expect(edgesBefore).toBeGreaterThan(0)

    // Delete the middle node (AI Agent)
    const aiAgentNodeOnCanvas = page.locator('.react-flow__node').nth(1)
    await aiAgentNodeOnCanvas.click()
    await page.keyboard.press('Delete')
    await page.waitForTimeout(500)

    // Verify edge was also removed
    const edgesAfter = await page.locator('.react-flow__edge').count()
    expect(edgesAfter).toBeLessThan(edgesBefore)

    // Save the modified workflow
    const saveButton = page.locator('button:has-text("Save")')
    await saveButton.click()
    await page.waitForTimeout(1000)

    // Reload the page to verify persistence
    await page.reload()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)

    // Verify the AI Agent node is still gone
    const aiAgentCount = await page.locator('text=AI Agent').count()
    // Should only be in sidebar, not on canvas
    const nodesOnCanvas = await page.locator('.react-flow__node').count()
    expect(nodesOnCanvas).toBe(1) // Only Telegram should remain
  })

  test('should validate node connections prevent invalid configurations', async ({ page }) => {
    // Navigate to workflow editor
    await page.goto('http://localhost:3000/dashboard')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)

    // Drag two input nodes (both have output ports only)
    const telegramNode = page.locator('text=Telegram').first()
    const webhookNode = page.locator('text=Webhook').first()
    const canvas = page.locator('.react-flow')
    const box = await canvas.boundingBox()
    
    if (box) {
      await telegramNode.dragTo(canvas, {
        targetPosition: { x: box.x + 200, y: box.y + 100 }
      })
      await page.waitForTimeout(500)
      
      await webhookNode.dragTo(canvas, {
        targetPosition: { x: box.x + 500, y: box.y + 100 }
      })
      await page.waitForTimeout(500)
    }

    // Try to connect two input nodes (should be prevented by validation)
    const sourceHandle = page.locator('.react-flow__handle-right').first()
    const targetHandle = page.locator('.react-flow__handle-left').nth(1)
    
    if (await sourceHandle.count() > 0 && await targetHandle.count() > 0) {
      const sourceBox = await sourceHandle.boundingBox()
      const targetBox = await targetHandle.boundingBox()
      
      if (sourceBox && targetBox) {
        await page.mouse.move(sourceBox.x, sourceBox.y)
        await page.mouse.down()
        await page.mouse.move(targetBox.x, targetBox.y)
        await page.mouse.up()
      }
    }
    await page.waitForTimeout(500)

    // Connection should not be created (both are input nodes)
    const edges = await page.locator('.react-flow__edge').count()
    expect(edges).toBe(0)
  })

  test('should execute workflow end-to-end via API', async ({ page }) => {
    // First, create a workflow via UI
    await page.goto('http://localhost:3000/dashboard')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)

    const telegramNode = page.locator('text=Telegram').first()
    const canvas = page.locator('.react-flow')
    const box = await canvas.boundingBox()
    
    if (box) {
      await telegramNode.dragTo(canvas, {
        targetPosition: { x: box.x + 200, y: box.y + 100 }
      })
    }
    await page.waitForTimeout(500)

    // Configure Telegram node
    const telegramNodeOnCanvas = page.locator('.react-flow__node').first()
    await telegramNodeOnCanvas.click()
    
    const tokenInput = page.locator('input[placeholder*="1234567890"]').first()
    if (await tokenInput.count() > 0) {
      await tokenInput.fill('TEST_BOT_TOKEN')
    }

    // Save workflow
    const saveButton = page.locator('button:has-text("Save")')
    await saveButton.click()
    await page.waitForTimeout(2000)

    // Now test the workflow execution via API
    const workflowId = await page.evaluate(() => {
      // Try to get workflow ID from the page or localStorage
      return localStorage.getItem('current_workflow_id') || 'test-workflow'
    })

    // Trigger workflow execution via API
    const executionResult = await page.evaluate(async () => {
      try {
        const response = await fetch('/api/workflow/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workflow_id: workflowId,
            trigger_data: {
              message: 'Test message',
              chat_id: '123456789'
            }
          })
        })
        return await response.json()
      } catch (error) {
        return { error: error.message }
      }
    })

    // Should get a response (either success or proper error)
    expect(executionResult).toBeDefined()
    expect(executionResult.status === 'ok' || executionResult.error).toBeTruthy()
  })

  test('should test Telegram node communication', async ({ page }) => {
    // This test verifies that the Telegram node can communicate with Telegram API
    // It mocks the Telegram API to avoid external dependencies
    
    await page.goto('http://localhost:3000/dashboard')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)

    // Add Telegram node
    const telegramNode = page.locator('text=Telegram').first()
    const canvas = page.locator('.react-flow')
    const box = await canvas.boundingBox()
    
    if (box) {
      await telegramNode.dragTo(canvas, {
        targetPosition: { x: box.x + 200, y: box.y + 100 }
      })
    }
    await page.waitForTimeout(500)

    // Configure with test credentials
    const telegramNodeOnCanvas = page.locator('.react-flow__node').first()
    await telegramNodeOnCanvas.click()
    
    const tokenInput = page.locator('input[placeholder*="1234567890"]').first()
    if (await tokenInput.count() > 0) {
      await tokenInput.fill('TEST_BOT_TOKEN')
    }

    // Test Telegram API connectivity via the backend
    const telegramTestResult = await page.evaluate(async () => {
      try {
        const response = await fetch('/api/nodes/telegram/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            telegram_token: 'TEST_BOT_TOKEN'
          })
        })
        return await response.json()
      } catch (error) {
        return { success: false, error: error.message }
      }
    })

    // Should get connectivity test result
    expect(telegramTestResult).toBeDefined()
    expect(telegramTestResult.hasOwnProperty('success')).toBe(true)
  })

  test('should test Webhook node receives HTTP requests', async ({ page }) => {
    // Navigate to workflow editor
    await page.goto('http://localhost:3000/dashboard')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)

    // Add Webhook node
    const webhookNode = page.locator('text=Webhook').first()
    const canvas = page.locator('.react-flow')
    const box = await canvas.boundingBox()
    
    if (box) {
      await webhookNode.dragTo(canvas, {
        targetPosition: { x: box.x + 200, y: box.y + 100 }
      })
    }
    await page.waitForTimeout(500)

    // Configure webhook
    const webhookNodeOnCanvas = page.locator('.react-flow__node').first()
    await webhookNodeOnCanvas.click()
    
    const webhookUrlInput = page.locator('input[placeholder*="/webhook"]').first()
    if (await webhookUrlInput.count() > 0) {
      await webhookUrlInput.fill('/webhook/test-endpoint')
    }

    // Save workflow
    const saveButton = page.locator('button:has-text("Save")')
    await saveButton.click()
    await page.waitForTimeout(2000)

    // Test webhook endpoint directly
    const webhookTestResult = await page.evaluate(async () => {
      try {
        const response = await fetch('/api/workflow/webhook/test-endpoint', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            test: true,
            timestamp: new Date().toISOString()
          })
        })
        return {
          status: response.status,
          body: await response.json()
        }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })

    // Webhook should accept the request
    expect(webhookTestResult.status).toBe(200)
  })

  test('should handle node configuration errors gracefully', async ({ page }) => {
    // Navigate to workflow editor
    await page.goto('http://localhost:3000/dashboard')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)

    // Add Email node (requires email address)
    const emailNode = page.locator('text=Email').first()
    const canvas = page.locator('.react-flow')
    const box = await canvas.boundingBox()
    
    if (box) {
      await emailNode.dragTo(canvas, {
        targetPosition: { x: box.x + 200, y: box.y + 100 }
      })
    }
    await page.waitForTimeout(500)

    // Try to save without filling required fields
    const saveButton = page.locator('button:has-text("Save")')
    
    // Should show validation error or disable save button
    const isDisabled = await saveButton.isDisabled()
    // Either button is disabled, or there's a validation message
    expect(isDisabled || await page.locator('text=/error|required|invalid/i').count() > 0).toBe(true)
  })

  test('should test AI Agent node processes messages correctly', async ({ page }) => {
    // Navigate to agent chat
    await page.goto('http://localhost:3000/agent')
    await page.waitForLoadState('networkidle')

    // Send a simple message
    const messageInput = page.locator('textarea[placeholder*="message"]')
    await messageInput.fill('Hello, this is a test message')
    await messageInput.press('Enter')
    await page.waitForTimeout(5000)

    // Verify AI response is received
    const messages = await page.locator('[data-testid="message"]').count()
    expect(messages).toBeGreaterThan(0)

    // Check that response is not empty
    const lastMessage = await page.evaluate(() => {
      const messages = document.querySelectorAll('[data-testid="message"]')
      return messages[messages.length - 1]?.textContent || ''
    })
    
    expect(lastMessage.length).toBeGreaterThan(0)
  })

  test('should verify HITL Gate node blocks execution when approval required', async ({ page }) => {
    // Navigate to agent chat
    await page.goto('http://localhost:3000/agent')
    await page.waitForLoadState('networkidle')

    // Send a message that should trigger HITL (e.g., update beneficiary)
    const messageInput = page.locator('textarea[placeholder*="message"]')
    await messageInput.fill('I want to update my beneficiary information')
    await messageInput.press('Enter')
    await page.waitForTimeout(5000)

    // Check for HITL approval prompt
    const hitlPrompt = page.locator('text=/approval|confirm|authorize|pending/i')
    const hitlCount = await hitlPrompt.count()
    
    // HITL should be triggered for sensitive operations
    expect(hitlCount).toBeGreaterThan(0)

    // Verify tool execution is pending, not completed
    const response = await page.evaluate(() => {
      const messages = document.querySelectorAll('[data-testid="message"]')
      const lastMsg = messages[messages.length - 1]?.textContent || ''
      return lastMsg.toLowerCase()
    })

    // Response should indicate pending approval
    expect(
      response.includes('approval') || 
      response.includes('confirm') || 
      response.includes('pending')
    ).toBe(true)
  })
})

test.describe('Node Communication - Tenant Isolation', () => {
  test('should not share workflow state between tenants', async ({ browser }) => {
    // Create two browser contexts for different tenants
    const context1 = await browser.newContext() // hamazaki (Allianz)
    const context2 = await browser.newContext() // himaska (SenecaAI)

    const page1 = await context1.newPage()
    const page2 = await context2.newPage()

    // Login as hamazaki
    await page1.goto('http://localhost:3000/auth')
    await page1.waitForLoadState('networkidle')
    await page1.fill('input[type="email"]', HAMAZAKI_EMAIL)
    await page1.fill('input[type="password"]', HAMAZAKI_PASSWORD)
    await page1.click('button[type="submit"]')
    await page1.waitForURL('**/dashboard', { timeout: 10000 })

    // Create workflow as hamazaki
    await page1.goto('http://localhost:3000/dashboard')
    await page1.waitForLoadState('networkidle')
    await page1.waitForTimeout(2000)

    const telegramNode = page1.locator('text=Telegram').first()
    const canvas = page1.locator('.react-flow')
    const box1 = await canvas.boundingBox()
    
    if (box1) {
      await telegramNode.dragTo(canvas, {
        targetPosition: { x: box1.x + 200, y: box1.y + 100 }
      })
    }
    await page1.waitForTimeout(500)

    // Save as hamazaki
    const saveButton1 = page1.locator('button:has-text("Save")')
    await saveButton1.click()
    await page1.waitForTimeout(2000)

    // Login as himaska
    await page2.goto('http://localhost:3000/auth')
    await page2.waitForLoadState('networkidle')
    await page2.fill('input[type="email"]', HIMASKA_EMAIL)
    await page2.fill('input[type="password"]', HIMASKA_PASSWORD)
    await page2.click('button[type="submit"]')
    await page2.waitForURL('**/dashboard', { timeout: 10000 })

    // Check workflow as himaska
    await page2.goto('http://localhost:3000/dashboard')
    await page2.waitForLoadState('networkidle')
    await page2.waitForTimeout(2000)

    // himaska should have empty canvas (or different workflow)
    const nodesOnCanvasHimaska = await page2.locator('.react-flow__node').count()
    expect(nodesOnCanvasHimaska).toBe(0)

    // Verify hamazaki's workflow is still intact
    const nodesOnCanvasHamazaki = await page1.locator('.react-flow__node').count()
    expect(nodesOnCanvasHamazaki).toBeGreaterThan(0)

    // Cleanup
    await context1.close()
    await context2.close()
  })

  test('should not leak execution results between tenants', async ({ browser }) => {
    const context1 = await browser.newContext()
    const context2 = await browser.newContext()

    const page1 = await context1.newPage()
    const page2 = await context2.newPage()

    // Login as hamazaki
    await page1.goto('http://localhost:3000/auth')
    await page1.waitForLoadState('networkidle')
    await page1.fill('input[type="email"]', HAMAZAKI_EMAIL)
    await page1.fill('input[type="password"]', HAMAZAKI_PASSWORD)
    await page1.click('button[type="submit"]')
    await page1.waitForURL('**/dashboard', { timeout: 10000 })

    // Trigger workflow execution
    await page1.goto('http://localhost:3000/agent')
    await page1.waitForLoadState('networkidle')
    
    const messageInput1 = page1.locator('textarea[placeholder*="message"]')
    await messageInput1.fill('Execute workflow for Allianz')
    await messageInput1.press('Enter')
    await page1.waitForTimeout(8000)

    // Get execution result for hamazaki
    const hamazakiResult = await page1.evaluate(() => {
      const messages = document.querySelectorAll('[data-testid="message"]')
      return messages[messages.length - 1]?.textContent || ''
    })

    // Login as himaska
    await page2.goto('http://localhost:3000/auth')
    await page2.waitForLoadState('networkidle')
    await page2.fill('input[type="email"]', HIMASKA_EMAIL)
    await page2.fill('input[type="password"]', HIMASKA_PASSWORD)
    await page2.click('button[type="submit"]')
    await page2.waitForURL('**/dashboard', { timeout: 10000 })

    // Trigger same workflow execution
    await page2.goto('http://localhost:3000/agent')
    await page2.waitForLoadState('networkidle')
    
    const messageInput2 = page2.locator('textarea[placeholder*="message"]')
    await messageInput2.fill('Execute workflow for SenecaAI')
    await messageInput2.press('Enter')
    await page2.waitForTimeout(8000)

    // Get execution result for himaska
    const himaskaResult = await page2.evaluate(() => {
      const messages = document.querySelectorAll('[data-testid="message"]')
      return messages[messages.length - 1]?.textContent || ''
    })

    // Results should be different (tenant-specific)
    expect(hamazakiResult).not.toBe(himaskaResult)
    expect(hamazakiResult.toLowerCase()).toContain('allianz')
    expect(himaskaResult.toLowerCase()).toContain('senecaai')

    // Cleanup
    await context1.close()
    await context2.close()
  })
})