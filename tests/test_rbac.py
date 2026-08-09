"""
RBAC (Role-Based Access Control) System Test

Tests the permission matrix and role logic for the three roles:
- Admin: Full control over everything
- Developer: Can build workflows, manage knowledge base, view metrics
- Viewer: Read-only access to dashboards, metrics, workflow visualizations

Run: python tests/test_rbac.py
"""

import json
import os
import sys
from pathlib import Path

# ──────────────────────────────────────────────
# Mirror of the TypeScript RBAC logic for testing
# ──────────────────────────────────────────────

ROLES = ["admin", "developer", "viewer"]

PERMISSIONS = [
    "dashboard:view",
    "knowledge:manage",
    "actions:manage",
    "agent:use",
    "marketplace:view",
    "metrics:view",
    "metrics:manage",
    "workflow:edit",
    "workflow:view",
    "users:manage",
    "settings:manage",
    "account:delete",
]

ROLE_PERMISSIONS = {
    "admin": [
        "dashboard:view",
        "knowledge:manage",
        "actions:manage",
        "agent:use",
        "marketplace:view",
        "metrics:view",
        "metrics:manage",
        "workflow:edit",
        "workflow:view",
        "users:manage",
        "settings:manage",
        "account:delete",
    ],
    "developer": [
        "dashboard:view",
        "knowledge:manage",
        "actions:manage",
        "agent:use",
        "marketplace:view",
        "metrics:view",
        "metrics:manage",
        "workflow:edit",
        "workflow:view",
        "account:delete",
    ],
    "viewer": [
        "dashboard:view",
        "metrics:view",
        "workflow:view",
    ],
}

ROUTE_PERMISSIONS = {
    "/dashboard": "dashboard:view",
    "/upload": "knowledge:manage",
    "/actions": "actions:manage",
    "/agent": "agent:use",
    "/marketplace": "marketplace:view",
    "/settings": "settings:manage",
}


def has_permission(role, permission):
    if not role or role not in ROLE_PERMISSIONS:
        return False
    return permission in ROLE_PERMISSIONS[role]


def can_access_route(role, pathname):
    if not role:
        return False
    for route, permission in ROUTE_PERMISSIONS.items():
        if pathname == route or pathname.startswith(route + "/"):
            return has_permission(role, permission)
    return True  # public route


def normalize_role(raw):
    if isinstance(raw, str):
        lower = raw.lower()
        if lower in ROLES:
            return lower
    return "admin"  # default for backward compat


# ──────────────────────────────────────────────
# Tests
# ──────────────────────────────────────────────

def test_admin_has_all_permissions():
    print("\n=== Testing Admin Role ===")
    for perm in PERMISSIONS:
        assert has_permission("admin", perm), f"Admin should have '{perm}'"
    print(f"✅ Admin has all {len(PERMISSIONS)} permissions")


def test_developer_permissions():
    print("\n=== Testing Developer Role ===")
    # Developer should have these
    dev_should_have = [
        "dashboard:view",
        "knowledge:manage",
        "actions:manage",
        "agent:use",
        "marketplace:view",
        "metrics:view",
        "metrics:manage",
        "workflow:edit",
        "workflow:view",
        "account:delete",
    ]
    for perm in dev_should_have:
        assert has_permission("developer", perm), f"Developer should have '{perm}'"
    print(f"✅ Developer has {len(dev_should_have)} expected permissions")

    # Developer should NOT have these
    dev_should_not_have = ["users:manage", "settings:manage"]
    for perm in dev_should_not_have:
        assert not has_permission("developer", perm), f"Developer should NOT have '{perm}'"
    print(f"✅ Developer correctly lacks {len(dev_should_not_have)} admin-only permissions")


def test_viewer_permissions():
    print("\n=== Testing Viewer Role ===")
    # Viewer should have these (read-only)
    viewer_should_have = [
        "dashboard:view",
        "metrics:view",
        "workflow:view",
    ]
    for perm in viewer_should_have:
        assert has_permission("viewer", perm), f"Viewer should have '{perm}'"
    print(f"✅ Viewer has {len(viewer_should_have)} read-only permissions")

    # Viewer should NOT have these
    viewer_should_not_have = [
        "knowledge:manage",
        "actions:manage",
        "agent:use",
        "marketplace:view",
        "metrics:manage",
        "workflow:edit",
        "users:manage",
        "settings:manage",
        "account:delete",
    ]
    for perm in viewer_should_not_have:
        assert not has_permission("viewer", perm), f"Viewer should NOT have '{perm}'"
    print(f"✅ Viewer correctly lacks {len(viewer_should_not_have)} write permissions")


def test_viewer_cannot_edit_workflows():
    print("\n=== Testing Viewer + Drag-Drop Nodes ===")
    # The key question: should viewers see the drag-drop editor?
    # Answer: NO — viewers have workflow:view but NOT workflow:edit
    assert has_permission("viewer", "workflow:view"), "Viewer should be able to view workflows"
    assert not has_permission("viewer", "workflow:edit"), "Viewer should NOT be able to edit workflows (drag-drop)"
    print("✅ Viewer can see workflow visualizations but CANNOT use the drag-drop editor")


def test_route_access():
    print("\n=== Testing Route Access ===")

    # Admin can access all routes
    for route in ROUTE_PERMISSIONS:
        assert can_access_route("admin", route), f"Admin should access {route}"
    print("✅ Admin can access all protected routes")

    # Developer can access most routes but not /settings
    dev_accessible = [r for r in ROUTE_PERMISSIONS if r != "/settings"]
    for route in dev_accessible:
        assert can_access_route("developer", route), f"Developer should access {route}"
    assert not can_access_route("developer", "/settings"), "Developer should NOT access /settings"
    print(f"✅ Developer can access {len(dev_accessible)} routes, blocked from /settings")

    # Viewer can only access dashboard (read-only routes)
    viewer_accessible = ["/dashboard"]
    for route in viewer_accessible:
        assert can_access_route("viewer", route), f"Viewer should access {route}"
    viewer_blocked = [r for r in ROUTE_PERMISSIONS if r not in viewer_accessible]
    for route in viewer_blocked:
        assert not can_access_route("viewer", route), f"Viewer should NOT access {route}"
    print(f"✅ Viewer can access {len(viewer_accessible)} routes, blocked from {len(viewer_blocked)} routes")


def test_normalize_role():
    print("\n=== Testing Role Normalization ===")
    # Valid roles
    assert normalize_role("admin") == "admin"
    assert normalize_role("developer") == "developer"
    assert normalize_role("viewer") == "viewer"
    # Case insensitive
    assert normalize_role("ADMIN") == "admin"
    assert normalize_role("Developer") == "developer"
    # Invalid/None defaults to admin (backward compat)
    assert normalize_role(None) == "admin"
    assert normalize_role("invalid") == "admin"
    assert normalize_role(123) == "admin"
    print("✅ Role normalization handles valid, case-insensitive, and invalid values")


def test_null_role():
    print("\n=== Testing Null/Empty Role ===")
    assert not has_permission(None, "dashboard:view"), "None role should have no permissions"
    assert not has_permission("", "dashboard:view"), "Empty role should have no permissions"
    assert not can_access_route(None, "/dashboard"), "None role should not access any route"
    print("✅ Null/empty roles correctly denied all permissions")


def test_permission_matrix_consistency():
    print("\n=== Testing Permission Matrix Consistency ===")
    # Every permission in the matrix should be a known permission
    for role, perms in ROLE_PERMISSIONS.items():
        for perm in perms:
            assert perm in PERMISSIONS, f"Unknown permission '{perm}' in role '{role}'"
    print(f"✅ All {len(PERMISSIONS)} permissions are valid across {len(ROLES)} roles")

    # Admin should be a superset of developer
    for perm in ROLE_PERMISSIONS["developer"]:
        assert perm in ROLE_PERMISSIONS["admin"], f"Admin missing dev permission '{perm}'"
    print("✅ Admin is a superset of Developer")

    # Developer should be a superset of viewer
    for perm in ROLE_PERMISSIONS["viewer"]:
        assert perm in ROLE_PERMISSIONS["developer"], f"Developer missing viewer permission '{perm}'"
    print("✅ Developer is a superset of Viewer")


def test_sql_migration_exists():
    print("\n=== Testing SQL Migration File ===")
    migration_path = Path(__file__).parent.parent / "supabase" / "migrations" / "20260802000000_add_role_to_profiles.sql"
    assert migration_path.exists(), f"Migration file should exist at {migration_path}"
    content = migration_path.read_text()
    assert "role" in content, "Migration should add role column"
    assert "admin" in content, "Migration should default to admin"
    assert "developer" in content, "Migration should mention developer"
    assert "viewer" in content, "Migration should mention viewer"
    assert "CHECK" in content.upper(), "Migration should have a CHECK constraint"
    print("✅ SQL migration file exists and contains correct role definitions")


def test_rbac_typescript_files_exist():
    print("\n=== Testing RBAC TypeScript Files ===")
    base = Path(__file__).parent.parent / "frontend"

    files_to_check = [
        "lib/rbac.ts",
        "lib/rbac-server.ts",
        "hooks/useRole.ts",
        "components/rbac/RoleGate.tsx",
        "components/rbac/RoleBadge.tsx",
    ]

    for f in files_to_check:
        path = base / f
        assert path.exists(), f"RBAC file should exist: {f}"
        print(f"  ✅ {f}")

    print(f"✅ All {len(files_to_check)} RBAC files exist")


if __name__ == "__main__":
    print("=" * 60)
    print("RBAC (Role-Based Access Control) System Test")
    print("=" * 60)

    try:
        test_admin_has_all_permissions()
        test_developer_permissions()
        test_viewer_permissions()
        test_viewer_cannot_edit_workflows()
        test_route_access()
        test_normalize_role()
        test_null_role()
        test_permission_matrix_consistency()
        test_sql_migration_exists()
        test_rbac_typescript_files_exist()

        print("\n" + "=" * 60)
        print("✅ All RBAC tests passed!")
        print("=" * 60)
        print("\nRBAC System Summary:")
        print(f"  Roles: {', '.join(ROLES)}")
        print(f"  Permissions: {len(PERMISSIONS)} granular permissions")
        print(f"  Routes protected: {len(ROUTE_PERMISSIONS)}")
        print(f"\n  Admin:     {len(ROLE_PERMISSIONS['admin'])} permissions (full access)")
        print(f"  Developer: {len(ROLE_PERMISSIONS['developer'])} permissions (build + configure)")
        print(f"  Viewer:    {len(ROLE_PERMISSIONS['viewer'])} permissions (read-only)")
        print(f"\n  Key decision: Viewers can VIEW workflows but CANNOT use the drag-drop editor.")

    except AssertionError as e:
        print(f"\n❌ Test failed: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)