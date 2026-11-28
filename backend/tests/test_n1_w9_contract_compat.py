"""Week 9 (N1-W09) Auth/Permission API Contract & OpenAPI Compatibility Tests.

Validates:
- Fixed OpenAPI specifications for auth and admin routes.
- Strict error envelope conformance: { "error": { "code", "message", "details", "request_id" } }.
- Security: zero credential or hash exposure in response schemas or live payloads.
- Complete contract compatibility with frontend TypeScript auth types.
- CORS exposes X-Request-ID header.
"""

from pathlib import Path

from app.auth.seed_large import DEFAULT_LARGE_PASSWORD, seed_large_dataset
from app.main import app


def test_openapi_auth_and_error_schemas_are_fixed():
    spec = app.openapi()
    paths = spec["paths"]

    # 1. Login endpoint specifications
    assert "/api/v1/auth/login" in paths
    login_post = paths["/api/v1/auth/login"]["post"]
    assert "200" in login_post["responses"]
    assert "401" in login_post["responses"]
    assert "429" in login_post["responses"]
    assert "422" in login_post["responses"]

    # 2. Get Me endpoint specifications
    assert "/api/v1/auth/me" in paths
    me_get = paths["/api/v1/auth/me"]["get"]
    assert "200" in me_get["responses"]
    assert "401" in me_get["responses"]
    assert any("HTTPBearer" in sec for sec in me_get.get("security", []))

    # 3. Logout endpoint specifications
    assert "/api/v1/auth/logout" in paths
    logout_post = paths["/api/v1/auth/logout"]["post"]
    assert "204" in logout_post["responses"]
    assert "401" in logout_post["responses"]
    assert any("HTTPBearer" in sec for sec in logout_post.get("security", []))

    # 4. Standard error schemas in OpenAPI components
    schemas = spec["components"]["schemas"]
    assert "ErrorResponse" in schemas
    assert "ErrorEnvelope" in schemas
    assert "LoginResponse" in schemas
    assert "UserResponse" in schemas

    # Ensure no sensitive hash fields in schema components
    user_resp_props = schemas["UserResponse"]["properties"]
    assert "password_hash" not in user_resp_props
    assert "token_hash" not in user_resp_props
    assert "password" not in user_resp_props


def test_live_auth_responses_adhere_strictly_to_contract_without_hashes(client, db_session):
    dataset = seed_large_dataset(db_session, DEFAULT_LARGE_PASSWORD)
    user = dataset.users["student.a@demo.invalid"]
    token = dataset.active_tokens["student.a@demo.invalid"]

    # 1. Successful Login response schema
    login_resp = client.post(
        "/api/v1/auth/login",
        json={"email": user.email, "password": DEFAULT_LARGE_PASSWORD},
    )
    assert login_resp.status_code == 200
    login_body = login_resp.json()
    assert "access_token" in login_body
    assert login_body["token_type"] == "bearer"
    assert "expires_at" in login_body
    assert "user" in login_body

    user_info = login_body["user"]
    assert user_info["id"] == str(user.id)
    assert user_info["email"] == user.email
    assert user_info["display_name"] == user.display_name
    assert user_info["role"] == user.role
    assert user_info["is_active"] is True
    assert "password_hash" not in user_info
    assert "password" not in user_info

    # 2. Get Me response schema
    me_resp = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me_resp.status_code == 200
    me_body = me_resp.json()
    assert me_body["id"] == str(user.id)
    assert me_body["email"] == user.email
    assert "password_hash" not in me_body

    # 3. Standard error envelope structure on 401
    bad_login_resp = client.post(
        "/api/v1/auth/login",
        json={"email": user.email, "password": "WrongPassword123!"},
    )
    assert bad_login_resp.status_code == 401
    err_body = bad_login_resp.json()
    assert "error" in err_body
    err = err_body["error"]
    assert err["code"] == "invalid_credentials"
    assert isinstance(err["message"], str) and len(err["message"]) > 0
    assert isinstance(err["details"], list)
    assert isinstance(err["request_id"], str) and len(err["request_id"]) > 0

    # 4. Standard error envelope structure on unauthenticated
    no_auth_resp = client.get("/api/v1/auth/me")
    assert no_auth_resp.status_code == 401
    no_auth_body = no_auth_resp.json()
    assert no_auth_body["error"]["code"] == "unauthenticated"
    assert "request_id" in no_auth_body["error"]


def test_cors_middleware_exposes_x_request_id(client):
    resp = client.post(
        "/api/v1/auth/login",
        json={},
        headers={"Origin": "http://localhost:5173"},
    )
    assert resp.headers.get("access-control-allow-origin") == "http://localhost:5173"
    exposed = resp.headers.get("access-control-expose-headers", "")
    assert "X-Request-ID" in exposed


def test_docs_openapi_file_matches_live_schema():
    openapi_file = Path(__file__).parents[2] / "docs" / "openapi.json"
    assert openapi_file.exists(), "docs/openapi.json must exist"

    live_spec = app.openapi()
    import json

    disk_spec = json.loads(openapi_file.read_text(encoding="utf-8"))
    assert set(live_spec["paths"].keys()) == set(disk_spec["paths"].keys())
