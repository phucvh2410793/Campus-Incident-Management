$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
    docker compose config --quiet
    if ($LASTEXITCODE -ne 0) { throw 'Compose configuration failed' }

    $live = Invoke-RestMethod 'http://localhost:8000/api/v1/health/live' -TimeoutSec 10
    if ($live.status -ne 'ok' -or $live.service -ne 'campus-incident-management-api') {
        throw 'Backend liveness failed'
    }
    $ready = Invoke-RestMethod 'http://localhost:8000/api/v1/health/ready' -TimeoutSec 10
    if ($ready.database -ne 'reachable') { throw 'Database readiness failed' }

    $page = Invoke-WebRequest 'http://localhost:5173' -TimeoutSec 10 -UseBasicParsing
    if ($page.Content -notmatch '<title>Campus Incident Management</title>') {
        throw 'Frontend project title failed'
    }
    $proxy = Invoke-RestMethod 'http://localhost:5173/api/v1/health/live' -TimeoutSec 10
    if ($proxy.service -ne 'campus-incident-management-api') { throw 'Frontend API proxy failed' }

    $n8nHealth = Invoke-WebRequest 'http://localhost:5678/healthz' -TimeoutSec 10 -UseBasicParsing
    if ($n8nHealth.StatusCode -ne 200) { throw 'n8n health failed' }

    docker compose exec -T backend alembic current
    if ($LASTEXITCODE -ne 0) { throw 'Migration revision check failed' }
    docker compose exec -T backend alembic check
    if ($LASTEXITCODE -ne 0) { throw 'Database schema differs from SQLAlchemy models' }

    docker compose exec -T n8n node --eval "fetch('http://backend:8000/api/v1/health/live').then(async r => { if (!r.ok) throw new Error('Backend unavailable'); const data = await r.json(); if (data.service !== 'campus-incident-management-api') throw new Error('Invalid service'); console.log('PASS: n8n-to-backend network'); }).catch(e => { console.error(e.message); process.exit(1); })"
    if ($LASTEXITCODE -ne 0) { throw 'n8n-to-backend network failed' }

    docker compose ps -a
    Write-Host 'PASS: Docker services, database migration, HTTP health, frontend proxy and n8n network.'
} finally {
    Pop-Location
}
