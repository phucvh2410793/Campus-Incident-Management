/**
 * Test N1-W09: Frontend Auth Contract & Real API Compatibility Test
 *
 * Verifies:
 * - Real API authentication via POST /api/v1/auth/login
 * - Bearer token propagation to staffApiAdapter
 * - GET /api/v1/auth/me session verification
 * - Error handling for HTTP 401 (invalid credentials) and HTTP 429 (rate limiting)
 * - Session revocation via POST /api/v1/auth/logout
 * - Offline fallback when backend is unreachable
 */

import { demoClient } from './src/api/demo-client.ts'
import { staffApiAdapter } from './src/api/staff-api-adapter.ts'
import type { LoginResponse } from './src/types/auth.ts'

let passed = 0
let failed = 0

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`✓ ${message}`)
    passed++
  } else {
    console.error(`✗ ${message}`)
    failed++
  }
}

async function runTests() {
  console.log('=== N1-W09 FRONTEND AUTH INTEGRATION TESTS ===\n')

  const originalFetch = globalThis.fetch

  try {
    // --------------------------------------------------------------------------
    // Test 1: Real API login success (200 OK)
    // --------------------------------------------------------------------------
    const mockSuccessResponse: LoginResponse = {
      access_token: 'test-real-opaque-token-12345',
      token_type: 'bearer',
      expires_at: new Date(Date.now() + 8 * 3600 * 1000).toISOString(),
      user: {
        id: '22e09230-76fd-4638-a97f-96919031e40b',
        email: 'reporter@usth.edu.vn',
        display_name: 'Lê Minh Tuấn (Sinh viên)',
        role: 'reporter',
        department_id: null,
        is_active: true,
      },
    }

    let capturedLoginBody: any = null
    let capturedHeaders: any = null

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/api/v1/auth/login')) {
        capturedLoginBody = JSON.parse(String(init?.body))
        capturedHeaders = init?.headers
        return new Response(JSON.stringify(mockSuccessResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response('Not found', { status: 404 })
    }

    staffApiAdapter.setMode('real')
    const session = await demoClient.login('reporter@usth.edu.vn', 'MyPassword123!')

    assert(session.accessToken === 'test-real-opaque-token-12345', 'Login returns real accessToken')
    assert(session.user.email === 'reporter@usth.edu.vn', 'Login returns valid user summary')
    assert(session.user.role === 'reporter', 'User role is correctly populated')
    assert(capturedLoginBody.email === 'reporter@usth.edu.vn', 'Request body contains normalized email')
    assert(capturedLoginBody.password === 'MyPassword123!', 'Request body passes password to backend')
    assert(demoClient.currentSession()?.accessToken === 'test-real-opaque-token-12345', 'currentSession() is populated')

    // --------------------------------------------------------------------------
    // Test 2: Real API GET /auth/me
    // --------------------------------------------------------------------------
    let capturedMeAuthHeader = ''
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/api/v1/auth/me')) {
        capturedMeAuthHeader = (init?.headers as any)?.['Authorization'] || ''
        return new Response(JSON.stringify(mockSuccessResponse.user), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response('Not found', { status: 404 })
    }

    const meUser = await demoClient.getMe()
    assert(meUser?.id === mockSuccessResponse.user.id, 'getMe() successfully verifies active session')
    assert(capturedMeAuthHeader === 'Bearer test-real-opaque-token-12345', 'getMe() includes Bearer token')

    // --------------------------------------------------------------------------
    // Test 3: Real API login 401 Unauthorized handling
    // --------------------------------------------------------------------------
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/v1/auth/login')) {
        return new Response(
          JSON.stringify({
            error: {
              code: 'invalid_credentials',
              message: 'Email hoặc mật khẩu không đúng.',
              details: [],
              request_id: 'test-req-401',
            },
          }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        )
      }
      return new Response('Not found', { status: 404 })
    }

    let threw401 = false
    try {
      await demoClient.login('reporter@usth.edu.vn', 'WrongPass!')
    } catch (err: any) {
      threw401 = true
      assert(err.message.includes('Email hoặc mật khẩu không đúng'), '401 throws user-friendly message from contract')
    }
    assert(threw401, '401 invalid credentials correctly throws exception')

    // --------------------------------------------------------------------------
    // Test 4: Real API login 429 Rate Limited handling
    // --------------------------------------------------------------------------
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/v1/auth/login')) {
        return new Response(
          JSON.stringify({
            error: {
              code: 'rate_limited',
              message: 'Quá nhiều lần đăng nhập sai. Hãy thử lại sau.',
              details: [],
              request_id: 'test-req-429',
            },
          }),
          { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '900' } }
        )
      }
      return new Response('Not found', { status: 404 })
    }

    let threw429 = false
    try {
      await demoClient.login('reporter@usth.edu.vn', 'WrongPass!')
    } catch (err: any) {
      threw429 = true
      assert(err.message.includes('Quá nhiều lần'), '429 rate limit throws user-friendly message from contract')
    }
    assert(threw429, '429 rate limit correctly throws exception')

    // --------------------------------------------------------------------------
    // Test 5: Real API logout with token revocation
    // --------------------------------------------------------------------------
    let capturedLogoutHeader = ''
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/api/v1/auth/logout')) {
        capturedLogoutHeader = (init?.headers as any)?.['Authorization'] || ''
        return new Response(null, { status: 204 })
      }
      return new Response('Not found', { status: 404 })
    }

    await demoClient.logout()
    assert(demoClient.currentSession() === null, 'logout() cleans current session in memory')
    assert(capturedLogoutHeader.includes('Bearer '), 'logout() dispatches POST /api/v1/auth/logout with Bearer token')

    // --------------------------------------------------------------------------
    // Test 6: Offline fallback when backend is unreachable
    // --------------------------------------------------------------------------
    staffApiAdapter.setMode('mock')
    globalThis.fetch = async () => {
      throw new Error('Failed to fetch (offline network)')
    }

    const offlineSession = await demoClient.login('reporter@usth.edu.vn')
    assert(offlineSession.accessToken.length > 0, 'Offline fallback still logs user in for demo')
    assert(offlineSession.user.email === 'reporter@usth.edu.vn', 'Offline fallback preserves user identity')

  } finally {
    globalThis.fetch = originalFetch
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed.`)
  if (failed > 0) {
    process.exit(1)
  }
}

runTests().catch(err => {
  console.error('Test runner error:', err)
  process.exit(1)
})
