/**
 * RBAC (Role-Based Access Control) System
 *
 * Three roles: admin, developer, viewer
 * Permissions are granular and mapped to UI routes/features.
 */

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export type Role = 'admin' | 'developer' | 'viewer'

export type AccountType = 'admin' | 'standard'

export type Permission =
  | 'dashboard:view'
  | 'knowledge:manage'
  | 'actions:manage'
  | 'agent:use'
  | 'marketplace:view'
  | 'metrics:view'
  | 'metrics:manage'
  | 'workflow:edit'
  | 'workflow:view'
  | 'users:manage'
  | 'settings:manage'
  | 'account:delete'

// ──────────────────────────────────────────────
// Permission Matrix
// ──────────────────────────────────────────────

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: [
    'dashboard:view',
    'knowledge:manage',
    'actions:manage',
    'agent:use',
    'marketplace:view',
    'metrics:view',
    'metrics:manage',
    'workflow:edit',
    'workflow:view',
    'users:manage',
    'settings:manage',
    'account:delete',
  ],
  developer: [
    'dashboard:view',
    'knowledge:manage',
    'actions:manage',
    'agent:use',
    'marketplace:view',
    'metrics:view',
    'metrics:manage',
    'workflow:edit',
    'workflow:view',
    'account:delete',
  ],
  viewer: [
    'dashboard:view',
    'metrics:view',
    'workflow:view',
  ],
}

// ──────────────────────────────────────────────
// Role Metadata (for UI display)
// ──────────────────────────────────────────────

export const ROLE_METADATA: Record<Role, {
  label: string
  description: string
  badgeColor: string
  badgeClass: string
}> = {
  admin: {
    label: 'Admin',
    description: 'Full control over everything — including user management and system settings.',
    badgeColor: 'red',
    badgeClass: 'bg-red-500/15 text-red-400 border-red-500/30',
  },
  developer: {
    label: 'Developer',
    description: 'Can build and configure workflows, manage the knowledge base, and view metrics.',
    badgeColor: 'blue',
    badgeClass: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  },
  viewer: {
    label: 'Viewer',
    description: 'Read-only access to dashboards, metrics, and workflow visualizations.',
    badgeColor: 'gray',
    badgeClass: 'bg-gray-500/15 text-gray-400 border-gray-500/30',
  },
}

export const ALL_ROLES: Role[] = ['admin', 'developer', 'viewer']

// ──────────────────────────────────────────────
// Route → Required Permission mapping
// ──────────────────────────────────────────────

export const ROUTE_PERMISSIONS: Record<string, Permission> = {
  '/dashboard': 'dashboard:view',
  '/actions': 'actions:manage',
  '/agent': 'agent:use',
  '/marketplace': 'marketplace:view',
  '/settings': 'settings:manage',
}

// ──────────────────────────────────────────────
// Helper Functions
// ──────────────────────────────────────────────

/**
 * Check if a role has a specific permission.
 */
export function hasPermission(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false
  const perms = ROLE_PERMISSIONS[role]
  return perms.includes(permission)
}

/**
 * Check if a role can access a specific route.
 */
export function canAccessRoute(role: Role | null | undefined, pathname: string): boolean {
  if (!role) return false

  // Find the matching route permission
  for (const [route, permission] of Object.entries(ROUTE_PERMISSIONS)) {
    if (pathname === route || pathname.startsWith(route + '/')) {
      return hasPermission(role, permission)
    }
  }

  // Public routes (auth, /) are always accessible
  return true
}

/**
 * Get the required permission for a route, or null if public.
 */
export function getRequiredPermission(pathname: string): Permission | null {
  for (const [route, permission] of Object.entries(ROUTE_PERMISSIONS)) {
    if (pathname === route || pathname.startsWith(route + '/')) {
      return permission
    }
  }
  return null
}

/**
 * Normalize a role string — handles legacy values, nulls, and case.
 * Defaults to 'admin' for backward compatibility (existing users keep full access).
 */
export function normalizeRole(raw: unknown): Role {
  if (typeof raw === 'string') {
    const lower = raw.toLowerCase()
    if (lower === 'admin' || lower === 'developer' || lower === 'viewer') {
      return lower
    }
  }
  // Default to admin so existing users don't lose access after migration
  return 'admin'
}

/**
 * Get a filtered list of nav links for a given role.
 */
export function getNavLinksForRole(role: Role | null | undefined): Array<{
  label: string
  href: string
  icon: string
  requiredPermission: Permission
}> {
  const allLinks = [
    { label: 'Overview', href: '/dashboard', icon: 'LayoutDashboard', requiredPermission: 'dashboard:view' as Permission },
    { label: 'Actions', href: '/actions', icon: 'Wrench', requiredPermission: 'actions:manage' as Permission },
    { label: 'Agent', href: '/agent', icon: 'Settings', requiredPermission: 'agent:use' as Permission },
    { label: 'Marketplace', href: '/marketplace', icon: 'Store', requiredPermission: 'marketplace:view' as Permission },
    { label: 'Settings', href: '/settings', icon: 'Settings', requiredPermission: 'settings:manage' as Permission },
  ]

  return allLinks.filter((link) => hasPermission(role, link.requiredPermission))
}

// ──────────────────────────────────────────────
// Account Type helpers (workspace system)
// ──────────────────────────────────────────────

export const ACCOUNT_TYPE_METADATA: Record<AccountType, {
  label: string
  description: string
}> = {
  admin: {
    label: 'Admin (Owner)',
    description: 'You own this workspace and pay for the platform. You get an invite code to bring team members in.',
  },
  standard: {
    label: 'Team Member',
    description: 'Join an existing workspace with an invite code from your admin. You\'ll be a developer or viewer.',
  },
}

export const ALL_ACCOUNT_TYPES: AccountType[] = ['admin', 'standard']

/**
 * Normalize an account type string.
 * Defaults to 'admin' for backward compatibility.
 */
export function normalizeAccountType(raw: unknown): AccountType {
  if (typeof raw === 'string') {
    const lower = raw.toLowerCase()
    if (lower === 'admin' || lower === 'standard') {
      return lower
    }
  }
  return 'admin'
}

/**
 * Generate a random 8-character invite code (uppercase alphanumeric).
 */
export function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no confusing chars
  let code = ''
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
}
