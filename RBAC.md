# RBAC (Role-Based Access Control) System

## Overview

The customer-service-agent platform now supports three user roles with granular permissions:

| Role | Description | Permissions |
|------|-------------|-------------|
| **Admin** | Full control over everything — including user management and system settings | 12 permissions |
| **Developer** | Can build and configure workflows, manage the knowledge base, and view metrics | 10 permissions |
| **Viewer** | Read-only access to dashboards, metrics, and workflow visualizations | 3 permissions |

## Permission Matrix

| Permission | Admin | Developer | Viewer |
|------------|:-----:|:---------:|:------:|
| `dashboard:view` | ✅ | ✅ | ✅ |
| `knowledge:manage` | ✅ | ✅ | — |
| `actions:manage` | ✅ | ✅ | — |
| `agent:use` | ✅ | ✅ | — |
| `marketplace:view` | ✅ | ✅ | — |
| `metrics:view` | ✅ | ✅ | ✅ |
| `metrics:manage` | ✅ | ✅ | — |
| `workflow:edit` | ✅ | ✅ | — |
| `workflow:view` | ✅ | ✅ | ✅ |
| `users:manage` | ✅ | — | — |
| `settings:manage` | ✅ | — | — |
| `account:delete` | ✅ | ✅ | — |

## Route Protection

| Route | Required Permission | Admin | Developer | Viewer |
|-------|-------------------|:-----:|:---------:|:------:|
| `/dashboard` | `dashboard:view` | ✅ | ✅ | ✅ |
| `/actions` | `actions:manage` | ✅ | ✅ | ❌ |
| `/agent` | `agent:use` | ✅ | ✅ | ❌ |
| `/marketplace` | `marketplace:view` | ✅ | ✅ | ❌ |
| `/metrics` | `metrics:view` | ✅ | ✅ | ✅ |
| `/settings` | `settings:manage` | ✅ | ❌ | ❌ |

## Key Design Decision: Viewer + Drag-Drop Nodes

**Viewers can VIEW workflows but CANNOT use the drag-drop editor.**

The `workflow:view` permission allows viewing rendered workflow visualizations (read-only), while `workflow:edit` is required for the interactive drag-and-drop node editor. This means:

- **Admin** and **Developer**: Full access to the drag-drop workflow editor
- **Viewer**: Can see a workflow visualization but the editor is hidden/blocked

## Workspace System (Account Linking)

The platform uses a **workspace model** to link admins and team members together:

| Account Type | Description |
|--------------|-------------|
| **Admin (Owner)** | Pays for the platform, owns the workspace, gets an invite code |
| **Standard (Team Member)** | Joins an existing workspace via invite code — is a developer or viewer |

### How it works

1. **Admin signs up** → Creates a new workspace. Their `workspace_id` = their own `user.id`. An 8-character invite code is generated.
2. **Team member signs up** → Chooses "Team Member", enters the invite code, and selects their role (developer or viewer). Their `workspace_id` is set to the admin's `user.id`.
3. **All team members share the same `workspace_id`** → They see the same AI agent, knowledge base, and metrics.

### Database Schema

```sql
-- Added by supabase/migrations/20260802000001_add_workspace_system.sql
ALTER TABLE profiles
  ADD COLUMN account_type TEXT NOT NULL DEFAULT 'admin'
    CHECK (account_type IN ('admin', 'standard'));

ALTER TABLE profiles
  ADD COLUMN workspace_id UUID;  -- admin's user.id

ALTER TABLE profiles
  ADD COLUMN invite_code TEXT UNIQUE;  -- admin only
```

### Invite Code Management

- Admins can view, copy, and regenerate their invite code at `/settings`
- Team members see their workspace info at `/settings`
- The invite code is an 8-character uppercase alphanumeric string (e.g., `ABCD1234`)

## Architecture

### Files Created

| File | Purpose |
|------|---------|
| `frontend/lib/rbac.ts` | Core RBAC logic — roles, permissions, account types, invite codes |
| `frontend/lib/rbac-server.ts` | Server-side helpers — `getAuthUser()`, `requirePermission()` |
| `frontend/hooks/useRole.ts` | Client-side hook — `useRole()` for client components |
| `frontend/components/rbac/RoleGate.tsx` | Conditional rendering component based on role |
| `frontend/components/rbac/RoleBadge.tsx` | Visual badge showing the user's role |
| `frontend/app/settings/page.tsx` | Settings page with role management + invite code UI |
| `supabase/migrations/20260802000000_add_role_to_profiles.sql` | SQL migration adding `role` column |
| `supabase/migrations/20260802000001_add_workspace_system.sql` | SQL migration adding workspace system |
| `tests/test_rbac.py` | Test suite for the RBAC system |

### Files Modified

| File | Changes |
|------|---------|
| `frontend/app/auth/page.tsx` | Two account types (Admin/Team Member) + invite code flow |
| `frontend/app/middleware.ts` | Added role-based route protection |
| `frontend/components/dashboard/dashboard-nav.tsx` | Nav links filtered by role + role badge |
| `frontend/app/dashboard/page.tsx` | Conditional rendering based on permissions |
| `frontend/app/actions.tsx` | Added `joinWorkspaceAction`, `regenerateInviteCodeAction`, `updateRoleAction`, `updateOwnRoleAction` |

## Setup Instructions

### 1. Run the SQL Migration

Execute the migration in your Supabase SQL editor:

```sql
-- From supabase/migrations/20260802000000_add_role_to_profiles.sql
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'admin'
  CHECK (role IN ('admin', 'developer', 'viewer'));
```

This adds a `role` column to the `profiles` table, defaulting to `admin` so existing users keep full access.

Then run the workspace migration:

```sql
-- From supabase/migrations/20260802000001_add_workspace_system.sql
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS account_type TEXT NOT NULL DEFAULT 'admin'
  CHECK (account_type IN ('admin', 'standard'));

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS workspace_id UUID;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS invite_code TEXT UNIQUE;
```

This adds the workspace linking system. Existing users are backfilled as admins of their own workspace with a generated invite code.

### 2. Using the RBAC System

#### In Server Components:

```typescript
import { getAuthUser, requirePermission } from '@/lib/rbac-server'

// Get the authenticated user with role
const authUser = await getAuthUser()

// Require a specific permission (redirects if insufficient)
await requirePermission('knowledge:manage')
```

#### In Client Components:

```typescript
import { useRole } from '@/hooks/useRole'

function MyComponent() {
  const { role, hasPermission, loading } = useRole()

  if (loading) return <Spinner />

  return hasPermission('workflow:edit') ? <Editor /> : <ReadOnlyView />
}
```

#### With RoleGate:

```tsx
import { RoleGate } from '@/components/rbac/RoleGate'

<RoleGate permission="knowledge:manage" fallback={<p>Access denied</p>}>
  <UploadForm />
</RoleGate>
```

### 3. Managing Roles

- **Self-service**: Users can change their own role at `/settings`
- **Admin-only**: Admins can change any user's role in the User Management section of `/settings`
- **During signup**: New users select their role during registration

## Testing

```bash
# Run the RBAC test suite
python tests/test_rbac.py

# Build the frontend (includes TypeScript checks)
cd frontend && npm run build