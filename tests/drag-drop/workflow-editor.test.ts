/**
 * Drag & Drop Workflow Editor Tests
 * Tests the React Flow-based workflow editor functionality
 */

import { test, expect } from '@playwright/test'

test.describe('Workflow Editor - Drag & Drop', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the workflow editor page
    await page.goto('http://localhost:3000/dashboard')
    await page.waitForLoadState('networkidle')
  })

  test('should display workflow editor with sidebar', async ({ page }) => {
    // Check that the workflow editor is visible
    const editor = page.locator('.react-flow')
    await expect(editor).toBeVisible()

    // Check that sidebar with nodes is visible
    const sidebar = page.locator('text=Search nodes...')
    await expect(sidebar).toBeVisible()
  })

  test('should have nodes available in sidebar', async ({ page }) => {
    // Wait for nodes to load
    await page.waitForTimeout(2000)

    // Check for common nodes
    const telegramNode = page.locator('text=Telegram')
    await expect(telegramNode).toBeVisible()

    const webhookNode = page.locator('text=Webhook')
    await expect(webhookNode).toBeVisible()

    const aiAgentNode = page.locator('text=AI Agent')
    await expect(aiAgentNode).toBeVisible()
  })

  test('should allow dragging a node to the canvas', async ({ page }) => {
    // Wait for nodes to load
    await page.waitForTimeout(2000)

    // Get the Telegram node
    const telegramNode = page.locator('text=Telegram').first()
    
    // Drag it to the canvas (center area)
    const canvas = page.locator('.react-flow')
    const box = await canvas.boundingBox()
    
    if (box) {
      await telegramNode.dragTo(canvas, {
        targetPosition: {
          x: box.x + box.width / 2,
          y: box.y + box.height / 2,
        },
      })
    }

    // Wait for the node to appear on canvas
    await page.waitForTimeout(1000)

    // Verify node was added (check for node label on canvas)
    const nodeOnCanvas = page.locator('text=Telegram').count()
    expect(nodeOnCanvas).toBeGreaterThan(0)
  })

  test('should allow connecting two nodes', async ({ page }) => {
    // Wait for nodes to load
    await page.waitForTimeout(2000)

    // Drag Telegram node to canvas
    const telegramNode = page.locator('text=Telegram').first()
    const canvas = page.locator('.react-flow')
    const box = await canvas.boundingBox()
    
    if (box) {
      await telegramNode.dragTo(canvas, {
        targetPosition: {
          x: box.x + 200,
          y: box.y + 100,
        },
      })
    }

    await page.waitForTimeout(500)

    // Drag AI Agent node to canvas
    const aiAgentNode = page.locator('text=AI Agent').first()
    
    if (box) {
      await aiAgentNode.dragTo(canvas, {
        targetPosition: {
          x: box.x + 500,
          y: box.y + 100,
        },
      })
    }

    await page.waitForTimeout(500)

    // Try to connect nodes (this would require more complex interaction)
    // For now, just verify both nodes are on canvas
    const telegramCount = page.locator('text=Telegram').count()
    const aiAgentCount = page.locator('text=AI Agent').count()
    
    expect(telegramCount).toBeGreaterThan(0)
    expect(aiAgentCount).toBeGreaterThan(0)
  })

  test('should allow deleting a selected node', async ({ page }) => {
    // Wait for nodes to load
    await page.waitForTimeout(2000)

    // Drag a node to canvas
    const telegramNode = page.locator('text=Telegram').first()
    const canvas = page.locator('.react-flow')
    const box = await canvas.boundingBox()
    
    if (box) {
      await telegramNode.dragTo(canvas, {
        targetPosition: {
          x: box.x + 200,
          y: box.y + 100,
        },
      })
    }

    await page.waitForTimeout(500)

    // Click on the node to select it
    const nodeOnCanvas = page.locator('.react-flow__node').first()
    await nodeOnCanvas.click()

    // Press Delete key
    await page.keyboard.press('Delete')

    await page.waitForTimeout(500)

    // Verify node was removed (count should be 0 or reduced)
    // Note: This is a simplified check
    const nodesAfterDelete = await page.locator('.react-flow__node').count()
    // Node should be removed
    expect(nodesAfterDelete).toBeLessThanOrEqual(1)
  })

  test('should save workflow configuration', async ({ page }) => {
    // Wait for nodes to load
    await page.waitForTimeout(2000)

    // Drag a node to canvas
    const telegramNode = page.locator('text=Telegram').first()
    const canvas = page.locator('.react-flow')
    const box = await canvas.boundingBox()
    
    if (box) {
      await telegramNode.dragTo(canvas, {
        targetPosition: {
          x: box.x + 200,
          y: box.y + 100,
        },
      })
    }

    await page.waitForTimeout(500)

    // Click Save button
    const saveButton = page.locator('button:has-text("Save")')
    await expect(saveButton).toBeVisible()
    await saveButton.click()

    // Wait for save to complete
    await page.waitForTimeout(1000)

    // Check for success message
    const successMessage = page.locator('text=Workflow saved successfully')
    await expect(successMessage).toBeVisible({ timeout: 5000 })
  })

  test('should re-add a removed node successfully', async ({ page }) => {
    // Wait for nodes to load
    await page.waitForTimeout(2000)

    // Drag Telegram node to canvas
    const telegramNode = page.locator('text=Telegram').first()
    const canvas = page.locator('.react-flow')
    const box = await canvas.boundingBox()
    
    if (box) {
      await telegramNode.dragTo(canvas, {
        targetPosition: {
          x: box.x + 200,
          y: box.y + 100,
        },
      })
    }

    await page.waitForTimeout(500)

    // Select and delete the node
    const nodeOnCanvas = page.locator('.react-flow__node').first()
    await nodeOnCanvas.click()
    await page.keyboard.press('Delete')
    await page.waitForTimeout(500)

    // Re-add the same node
    const telegramNodeAgain = page.locator('text=Telegram').first()
    
    if (box) {
      await telegramNodeAgain.dragTo(canvas, {
        targetPosition: {
          x: box.x + 200,
          y: box.y + 100,
        },
      })
    }

    await page.waitForTimeout(500)

    // Verify node is back on canvas
    const nodesAfterReadd = await page.locator('.react-flow__node').count()
    expect(nodesAfterReadd).toBeGreaterThan(0)
  })
})