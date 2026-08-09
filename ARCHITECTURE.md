# Dashboard & Actions Page Architecture

## ✅ Corrected Structure (v2 — Custom Draggable GUI)

### Dashboard Page (Overview)
**Location**: `app/dashboard/page.tsx`

**Features**:
- Clean layout: **Header (DashboardNav) → Draggable Widget Canvas** (everything below the header was removed)
- **Custom draggable GUIs** via `@dnd-kit/core`:
  - Drag any widget by its **⋮⋮ grip handle** (top-left of each card)
  - Widgets **snap to a 12-column grid** on drop
  - **Collision resolution** — overlapping widgets are auto-pushed down
  - Drag is clamped to the canvas area (`restrictToParentElement`)
  - Auto-saves positions with 1.5s debounce via `applyLayout()`
- **Widget Palette** (closed by default) with:
  - Token Consumption, Cost Per Session, Latency, Error Rate, Recent Traces
  - Platform Usage, Resolution Rate, Message Volume, Knowledge Sources
  - **Custom Metric** (track deflection rate, tickets resolved, CSAT, etc.)
- **AI Widget Builder is NOT here anymore** — it lives only in the Actions page

---

### Actions Page
**Location**: `app/actions/page.tsx`

**Sidebar Sections** (3 tabs):

1. **Agent Tasks** (existing)
   - Manage JSON API definitions

2. **Agentic Workflow** (existing)
   - Uses ExtensionPage (React Flow workflow editor)
   - Node palette built in (Activepieces + Platform nodes), closed by default

3. **AI Coder** (NEW — separate sidebar section)
   - Dedicated AI widget builder, NOT part of agentic workflow
   - Helps users create custom dashboard widgets via natural language
   - Fixed: clicking "AI Coder" now shows the builder (was returning to tasks)

---

## 🎨 Draggable Dashboard Implementation

| File | Role |
|------|------|
| `components/dashboard/dashboard-canvas.tsx` | DndContext + grid snapping + collision resolution |
| `components/dashboard/widgets/drag-context.tsx` | Threads @dnd-kit listeners to each widget's grip handle |
| `components/dashboard/widgets/widget-card.tsx` | Applies drag listeners to its ⋮⋮ grip icon |
| `hooks/useDashboard.ts` | Added `applyLayout()` to commit + save dragged positions |

**Drag flow**:
1. User grabs the grip handle → `PointerSensor` activates after 8px move
2. Widget follows pointer via CSS transform (live preview)
3. On drop: delta is divided by column/row size → snapped to nearest grid cell
4. Overlapping widgets get pushed down by `resolveCollisions()`
5. Layout committed via `applyLayout()` and auto-saved

---

## 📁 File Structure

```
frontend/
├── app/
│   ├── dashboard/
│   │   └── page.tsx                      # Header + draggable canvas only
│   └── actions/
│       └── page.tsx                      # 3 sidebar sections incl. AI Coder
│
├── components/
│   ├── dashboard/
│   │   ├── dashboard-canvas.tsx          # @dnd-kit draggable canvas
│   │   ├── node-palette.tsx              # Workflow nodes (for Actions page)
│   │   ├── extensionpage.tsx             # React Flow workflow editor
│   │   └── widgets/
│   │       ├── types.ts                  # Widget type definitions
│   │       ├── widget-registry.ts        # Registry (NO ai-coder — dashboard only)
│   │       ├── drag-context.tsx          # Drag handle context
│   │       ├── widget-card.tsx           # Apply drag listeners to grip
│   │       ├── custom-metric-widget.tsx  # Custom metric tracker
│   │       ├── ai-coder-widget.tsx       # AI builder (used by Actions page)
│   │       └── ... (other widgets)
│   └── ui/ ...
└── ARCHITECTURE.md                       # This file
```

---

## 🚀 Key Benefits

1. **True drag-and-drop** with grid snapping (previously removed for stability)
2. Clean dashboard = just header + canvas (removed static hero + tenant grid below header)
3. AI Coder is correctly isolated in Actions page (NOT in dashboard palette)
4. Proprietary edge: Custom Metric widget + Platform-specific workflow nodes
5. Type-safe, zero TS errors, auto-saves layout
