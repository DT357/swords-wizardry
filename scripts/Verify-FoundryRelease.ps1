[CmdletBinding()]
param(
  [string]$PortableRoot = 'F:\FoundryVTT',
  [string]$RuntimeRoot,
  [int[]]$Generations = @(13, 14),
  [string]$TestGrep = ''
)

$ErrorActionPreference = 'Stop'
function Invoke-Verification {
$repositoryRoot = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot)).TrimEnd('\')
$projectRoot = [System.IO.Path]::GetFullPath((Split-Path -Parent $repositoryRoot)).TrimEnd('\')
if (-not $RuntimeRoot) { $RuntimeRoot = Join-Path $projectRoot 'RuntimeTests' }
$RuntimeRoot = [System.IO.Path]::GetFullPath($RuntimeRoot).TrimEnd('\')
$expectedRuntimeRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot 'RuntimeTests')).TrimEnd('\')
if (-not $RuntimeRoot.Equals($expectedRuntimeRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing unexpected runtime root: $RuntimeRoot"
}

$archivePath = Join-Path $repositoryRoot 'dist\swords-wizardry.zip'
$fileManifestPath = Join-Path $repositoryRoot 'dist\FILES.txt'
if (-not (Test-Path -LiteralPath $archivePath -PathType Leaf)) {
  throw "Missing release archive: $archivePath"
}
if (-not (Test-Path -LiteralPath $fileManifestPath -PathType Leaf)) {
  throw "Missing release file manifest: $fileManifestPath"
}
$candidateHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
$nodeCandidates = Get-NodeRuntimeCandidates -PortableRoot $PortableRoot
if (-not $nodeCandidates.Count) { throw 'No usable Node runtime was found.' }

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$failures = @()
foreach ($generation in $Generations) {
  $minimumNodeMajor = if ($generation -ge 14) { 24 } else { 20 }
  $nodeRuntime = $nodeCandidates |
    Where-Object { $_.Version.Major -ge $minimumNodeMajor } |
    Sort-Object Version |
    Select-Object -First 1
  if (-not $nodeRuntime) {
    throw "Foundry v$generation requires Node $minimumNodeMajor or newer, but no compatible runtime was found."
  }
  $nodePath = $nodeRuntime.Path
  $port = if ($generation -eq 13) { 31131 } else { 31141 }
  $worldId = "sw-spell-cards-v$generation"
  $routePrefix = if ($generation -eq 14) { 'sw-fixes' } else { '' }
  $runtimePath = Join-Path $RuntimeRoot "v$generation"
  $dataPath = Join-Path $runtimePath 'Data'
  $configPath = Join-Path $runtimePath 'Config'
  $evidencePath = Join-Path $runtimePath "Evidence\fixes-$timestamp"
  $worldPath = Join-Path $dataPath "worlds\$worldId"
  $portable = Get-ChildItem -LiteralPath $PortableRoot -Directory -Filter "FoundryVTT-WindowsPortable-$generation.*" |
    Sort-Object Name -Descending | Select-Object -First 1
  if (-not $portable) { throw "Foundry v$generation portable installation was not found." }
  $serverEntry = Join-Path $portable.FullName 'App\resources\app\main.mjs'
  foreach ($requiredPath in @($runtimePath, $dataPath, $configPath, $worldPath, $serverEntry)) {
    if (-not (Test-Path -LiteralPath $requiredPath)) { throw "Missing runtime path: $requiredPath" }
  }
  if (-not (Test-Path -LiteralPath (Join-Path $configPath 'license.json') -PathType Leaf)) {
    throw "The isolated v$generation runtime has no license configuration."
  }
  if (Test-TcpPort -Port $port) { throw "Test port $port is already in use." }

  New-Item -ItemType Directory -Path $evidencePath -Force | Out-Null
  $worldBackup = Join-Path $runtimePath "Backups\fixes-$timestamp\$worldId"
  if (Test-Path -LiteralPath $worldBackup) { throw "World backup already exists: $worldBackup" }
  New-Item -ItemType Directory -Path (Split-Path -Parent $worldBackup) -Force | Out-Null
  Copy-Item -LiteralPath $worldPath -Destination $worldBackup -Recurse

  Install-ZipCandidate `
    -ArchivePath $archivePath `
    -CollectionRoot (Join-Path $dataPath 'systems') `
    -PackageId 'swords-wizardry' `
    -ManifestName 'system.json' `
    -BackupRoot (Join-Path $runtimePath "CandidateBackups\fixes-$timestamp")
  Quarantine-LegacyDiagnostic `
    -CollectionRoot (Join-Path $dataPath 'modules') `
    -BackupRoot (Join-Path $runtimePath "CandidateBackups\fixes-$timestamp")
  Install-DirectoryCandidate `
    -SourcePath (Join-Path $repositoryRoot 'tests\foundry\spell-diagnostics') `
    -CollectionRoot (Join-Path $dataPath 'modules') `
    -PackageId 'swords-wizardry-spell-diagnostics' `
    -ManifestName 'module.json' `
    -BackupRoot (Join-Path $runtimePath "CandidateBackups\fixes-$timestamp")

  $stdoutPath = Join-Path $evidencePath 'server.stdout.log'
  $stderrPath = Join-Path $evidencePath 'server.stderr.log'
  $arguments = @(
    "`"$serverEntry`"",
    "--dataPath=`"$runtimePath`"",
    "--port=$port",
    "--world=$worldId",
    '--nobackups'
  )
  $server = $null
  $generationFailure = $null
  $optionsPath = Join-Path $configPath 'options.json'
  $originalOptionsText = $null
  try {
    if ($routePrefix) {
      $originalOptionsText = Get-Content -LiteralPath $optionsPath -Raw
      $runtimeOptions = $originalOptionsText | ConvertFrom-Json
      $runtimeOptions.routePrefix = $routePrefix
      [System.IO.File]::WriteAllText(
        $optionsPath,
        ($runtimeOptions | ConvertTo-Json -Depth 20),
        [System.Text.UTF8Encoding]::new($false)
      )
    }
    $server = Start-Process `
      -FilePath $nodePath `
      -ArgumentList $arguments `
      -PassThru `
      -WindowStyle Hidden `
      -RedirectStandardOutput $stdoutPath `
      -RedirectStandardError $stderrPath
    $baseUrl = "http://127.0.0.1:$port"
    if ($routePrefix) { $baseUrl = "$baseUrl/$routePrefix/" }
    Wait-FoundryServer -BaseUrl $baseUrl -Process $server -TimeoutSeconds 60

    $previousEnvironment = @{}
    foreach ($name in @(
      'SW_FOUNDRY_E2E', 'SW_FOUNDRY_DISPOSABLE_WORLD', 'SW_FOUNDRY_URL',
      'SW_FOUNDRY_WORLD_ID', 'SW_FOUNDRY_GM_NAME', 'SW_FOUNDRY_GM_PASSWORD',
      'SW_FOUNDRY_PLAYER_NAME', 'SW_FOUNDRY_PLAYER_PASSWORD',
      'SW_FOUNDRY_CREATOR_NAME', 'SW_FOUNDRY_CREATOR_PASSWORD',
      'SW_FOUNDRY_SECOND_GM_NAME', 'SW_FOUNDRY_SECOND_GM_PASSWORD',
      'SW_EVIDENCE_DIR'
    )) { $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
    try {
      $env:SW_FOUNDRY_E2E = '1'
      $env:SW_FOUNDRY_DISPOSABLE_WORLD = 'YES'
      $env:SW_FOUNDRY_URL = $baseUrl
      $env:SW_FOUNDRY_WORLD_ID = $worldId
      $env:SW_FOUNDRY_GM_NAME = 'Gamemaster'
      $env:SW_FOUNDRY_GM_PASSWORD = ''
      $env:SW_FOUNDRY_PLAYER_NAME = 'Test Player'
      $env:SW_FOUNDRY_PLAYER_PASSWORD = ''
      $env:SW_FOUNDRY_CREATOR_NAME = 'Test Creator'
      $env:SW_FOUNDRY_CREATOR_PASSWORD = ''
      $env:SW_FOUNDRY_SECOND_GM_NAME = 'Test GM 2'
      $env:SW_FOUNDRY_SECOND_GM_PASSWORD = ''
      $env:SW_EVIDENCE_DIR = $evidencePath

      & $nodePath (Join-Path $repositoryRoot 'scripts\provision-foundry-test-world.mjs')
      if ($LASTEXITCODE -ne 0) { throw "v$generation provisioning failed with exit code $LASTEXITCODE." }
      $playwrightArguments = @(
        (Join-Path $repositoryRoot 'node_modules\@playwright\test\cli.js'),
        'test'
      )
      if ($TestGrep) { $playwrightArguments += @('--grep', $TestGrep) }
      & $nodePath @playwrightArguments
      if ($LASTEXITCODE -ne 0) { throw "v$generation Playwright failed with exit code $LASTEXITCODE." }
    }
    finally {
      foreach ($entry in $previousEnvironment.GetEnumerator()) {
        [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Process')
      }
    }
  }
  catch {
    $generationFailure = $_
    $failures += "v${generation}: $($_.Exception.Message)"
  }
  finally {
    if ($server -and -not $server.HasExited) {
      Stop-Process -Id $server.Id -Force
      $null = $server.WaitForExit(15000)
    }
    if ($null -ne $originalOptionsText) {
      [System.IO.File]::WriteAllText(
        $optionsPath,
        $originalOptionsText,
        [System.Text.UTF8Encoding]::new($false)
      )
    }
    Start-Sleep -Milliseconds 500
    if (Test-TcpPort -Port $port) {
      $failures += "v${generation}: test port $port remained open after server shutdown."
    }
    $systemManifest = Get-Content -LiteralPath (Join-Path $dataPath 'systems\swords-wizardry\system.json') -Raw | ConvertFrom-Json
    $metadata = [ordered]@{
      generation = $generation
      foundryPortable = $portable.Name
      foundryBuild = $portable.Name -replace '^.*-', ''
      nodeVersion = (& $nodePath --version)
      systemId = $systemManifest.id
      systemVersion = $systemManifest.version
      candidateSha256 = $candidateHash
      worldId = $worldId
      routePrefix = $routePrefix
      portClosed = -not (Test-TcpPort -Port $port)
      result = if ($generationFailure) { 'failed' } else { 'passed' }
      finishedAt = (Get-Date).ToString('o')
    }
    $metadata | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $evidencePath 'metadata.json') -Encoding utf8
    Copy-Item -LiteralPath $fileManifestPath -Destination (Join-Path $evidencePath 'FILES.txt')
  }
}

if ($failures.Count) {
  throw "Release verification failed:`n$($failures -join "`n")"
}
Write-Host "Foundry v13/v14 release verification passed for $candidateHash"
}

function Install-ZipCandidate {
  param($ArchivePath, $CollectionRoot, $PackageId, $ManifestName, $BackupRoot)
  $temporary = Join-Path $CollectionRoot ".$PackageId-candidate-$PID"
  Assert-ExactChild -Parent $CollectionRoot -Child $temporary
  if (Test-Path -LiteralPath $temporary) { throw "Candidate staging path exists: $temporary" }
  New-Item -ItemType Directory -Path $temporary | Out-Null
  try {
    Expand-Archive -LiteralPath $ArchivePath -DestinationPath $temporary
    Install-StagedCandidate -StagedPath $temporary -CollectionRoot $CollectionRoot -PackageId $PackageId -ManifestName $ManifestName -BackupRoot $BackupRoot
  }
  catch {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Recurse -Force }
    throw
  }
}

function Install-DirectoryCandidate {
  param($SourcePath, $CollectionRoot, $PackageId, $ManifestName, $BackupRoot)
  $temporary = Join-Path $CollectionRoot ".$PackageId-candidate-$PID"
  Assert-ExactChild -Parent $CollectionRoot -Child $temporary
  if (Test-Path -LiteralPath $temporary) { throw "Candidate staging path exists: $temporary" }
  Copy-Item -LiteralPath $SourcePath -Destination $temporary -Recurse
  try {
    Install-StagedCandidate -StagedPath $temporary -CollectionRoot $CollectionRoot -PackageId $PackageId -ManifestName $ManifestName -BackupRoot $BackupRoot
  }
  catch {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Recurse -Force }
    throw
  }
}

function Quarantine-LegacyDiagnostic {
  param($CollectionRoot, $BackupRoot)
  $legacyPath = Join-Path $CollectionRoot 'sw-spell-diagnostics'
  Assert-ExactChild -Parent $CollectionRoot -Child $legacyPath
  if (-not (Test-Path -LiteralPath $legacyPath -PathType Container)) { return }

  $manifestPath = Join-Path $legacyPath 'module.json'
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "Refusing unrecognized legacy diagnostic directory: $legacyPath"
  }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  if ($manifest.id -ne 'swords-wizardry-spell-diagnostics') {
    throw "Refusing legacy diagnostic with unexpected id '$($manifest.id)'."
  }

  New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null
  $backup = Join-Path $BackupRoot 'legacy-sw-spell-diagnostics'
  if (Test-Path -LiteralPath $backup) { throw "Legacy diagnostic backup exists: $backup" }
  Move-Item -LiteralPath $legacyPath -Destination $backup
}

function Install-StagedCandidate {
  param($StagedPath, $CollectionRoot, $PackageId, $ManifestName, $BackupRoot)
  $manifestPath = Join-Path $StagedPath $ManifestName
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  if ($manifest.id -ne $PackageId) { throw "Candidate manifest id '$($manifest.id)' does not match '$PackageId'." }
  $target = Join-Path $CollectionRoot $PackageId
  Assert-ExactChild -Parent $CollectionRoot -Child $target
  if (Test-Path -LiteralPath $target) {
    New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null
    $backup = Join-Path $BackupRoot $PackageId
    if (Test-Path -LiteralPath $backup) { throw "Candidate backup exists: $backup" }
    Move-Item -LiteralPath $target -Destination $backup
  }
  Move-Item -LiteralPath $StagedPath -Destination $target
}

function Assert-ExactChild {
  param($Parent, $Child)
  $resolvedParent = [System.IO.Path]::GetFullPath($Parent).TrimEnd('\')
  $resolvedChild = [System.IO.Path]::GetFullPath($Child).TrimEnd('\')
  if (-not (Split-Path -Parent $resolvedChild).Equals($resolvedParent, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing non-child path: $resolvedChild"
  }
}

function Get-NodeRuntimeCandidates {
  param($PortableRoot)
  $paths = @(
    Get-ChildItem -LiteralPath $PortableRoot -Directory -Filter 'node-v*-win-x64' |
      ForEach-Object { Join-Path $_.FullName 'node.exe' }
  )
  $systemNode = Get-Command node -CommandType Application -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($systemNode) { $paths += $systemNode.Source }

  return @($paths | Select-Object -Unique | ForEach-Object {
    if (-not (Test-Path -LiteralPath $_ -PathType Leaf)) { return }
    $versionText = & $_ --version
    try {
      $version = [version]$versionText.TrimStart('v')
    } catch {
      return
    }
    [pscustomobject]@{ Path = $_; Version = $version }
  })
}

function Wait-FoundryServer {
  param($BaseUrl, $Process, $TimeoutSeconds)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    if ($Process.HasExited) { throw "Foundry server exited with code $($Process.ExitCode)." }
    try {
      $response = Invoke-WebRequest -Uri $BaseUrl -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) { return }
    } catch {}
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)
  throw "Timed out waiting for Foundry at $BaseUrl."
}

function Test-TcpPort {
  param([int]$Port)
  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $task = $client.ConnectAsync('127.0.0.1', $Port)
    return $task.Wait(250) -and $client.Connected
  } catch { return $false } finally { $client.Dispose() }
}

Invoke-Verification
