import assert from 'node:assert/strict'
import { demoClient } from './src/api/demo-client.ts'
import { MOCK_USERS } from './src/mocks/mock-users.ts'
import { mockApi } from './src/mocks/mock-api-service.ts'
import { matchesNavigationTab } from './src/features/staff/matchesNavigationTab.ts'

async function main() {
  mockApi.settings.latencyMs = 0
  assert.equal(demoClient.currentSession(), null)
  await assert.rejects(() => demoClient.reporterIncidents())

  const reporter = await demoClient.login(MOCK_USERS['user-reporter'].email)
  assert.equal(reporter.user.role, 'reporter')
  assert.ok(reporter.accessToken.startsWith('mock-bearer-'))
  const own = await demoClient.reporterIncidents()
  assert.ok(own.length > 0 && own.every((incident) => incident.department_id === null))
  await assert.rejects(() => demoClient.staffIncidents())
  demoClient.logout()
  assert.equal(demoClient.currentSession(), null)

  const handler = await demoClient.login(MOCK_USERS['user-handler-csvc'].email)
  const assigned = await demoClient.staffIncidents()
  assert.ok(assigned.length > 0 && assigned.every((incident) => incident.assigned_handler_id === handler.user.id))
  assert.deepEqual(await demoClient.staffIncidents({ search: 'không tồn tại 123' }), [])
  demoClient.logout()

  const admin = await demoClient.login(MOCK_USERS['user-admin'].email)
  assert.equal(admin.user.role, 'administrator')
  const all = await demoClient.staffIncidents()
  assert.ok(new Set(all.map((incident) => incident.department_id)).size > 1)
  assert.ok((await demoClient.reporterIncidents()).length >= own.length)
  assert.equal(all.filter((incident) => matchesNavigationTab(incident, 'admin-triage')).length, 1)
  assert.equal(all.filter((incident) => matchesNavigationTab(incident, 'admin-unassigned')).length, 2)
  assert.equal(all.filter((incident) => matchesNavigationTab(incident, 'admin-sla')).length, 2)
  assert.ok(all.some((incident) => incident.status === 'closed' && matchesNavigationTab(incident, 'handler-completed')))
  demoClient.logout()
  console.log('PASS: W2 mock login/logout, in-memory session, role scope and navigation filters')
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
