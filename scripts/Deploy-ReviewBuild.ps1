[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$FoundryDataPath,

  [switch]$IncludeDiagnostics
)

$ErrorActionPreference = 'Stop'
function Assert-PackageIdentity {
  param(
    [Parameter(Mandatory = $true)][string]$ManifestPath,
    [Parameter(Mandatory = $true)][string]$ExpectedId
  )
  if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) {
    throw "Missing package manifest: $ManifestPath"
  }
  $manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
  if ($manifest.id -ne $ExpectedId) {
    throw "Manifest id '$($manifest.id)' does not match '$ExpectedId'."
  }
}

function Install-ReviewPackage {
  param(
    [Parameter(Mandatory = $true)][string]$SourcePath,
    [Parameter(Mandatory = $true)][string]$CollectionRoot,
    [Parameter(Mandatory = $true)][string]$PackageId,
    [Parameter(Mandatory = $true)][string]$ManifestName,
    [Parameter(Mandatory = $true)][string]$BackupRoot,
    [Parameter(Mandatory = $true)][string]$Timestamp
  )

  $resolvedCollectionRoot = [System.IO.Path]::GetFullPath($CollectionRoot).TrimEnd('\')
  $targetPath = [System.IO.Path]::GetFullPath(
    (Join-Path $resolvedCollectionRoot $PackageId)
  )
  $expectedTarget = Join-Path $resolvedCollectionRoot $PackageId
  if (-not $targetPath.Equals($expectedTarget, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing unexpected deployment target: $targetPath"
  }
  if (-not (Test-Path -LiteralPath $resolvedCollectionRoot -PathType Container)) {
    throw "Foundry collection path does not exist: $resolvedCollectionRoot"
  }

  $temporaryPath = Join-Path $resolvedCollectionRoot ".$PackageId-review-$PID"
  if (Test-Path -LiteralPath $temporaryPath) {
    throw "Temporary deployment path already exists: $temporaryPath"
  }
  Copy-Item -LiteralPath $SourcePath -Destination $temporaryPath -Recurse
  Assert-PackageIdentity `
    -ManifestPath (Join-Path $temporaryPath $ManifestName) `
    -ExpectedId $PackageId

  $backupPath = $null
  if (Test-Path -LiteralPath $targetPath) {
    Assert-PackageIdentity `
      -ManifestPath (Join-Path $targetPath $ManifestName) `
      -ExpectedId $PackageId
    if (-not (Test-Path -LiteralPath $BackupRoot -PathType Container)) {
      New-Item -ItemType Directory -Path $BackupRoot | Out-Null
    }
    $backupPath = Join-Path $BackupRoot "$PackageId-$Timestamp"
    if (Test-Path -LiteralPath $backupPath) {
      throw "Backup path already exists: $backupPath"
    }
    Move-Item -LiteralPath $targetPath -Destination $backupPath
  }

  try {
    Move-Item -LiteralPath $temporaryPath -Destination $targetPath
  }
  catch {
    if ($backupPath -and -not (Test-Path -LiteralPath $targetPath)) {
      Move-Item -LiteralPath $backupPath -Destination $targetPath
    }
    throw
  }

  [pscustomobject]@{
    Package = $PackageId
    InstalledPath = $targetPath
    BackupPath = $backupPath
  }
}

$packageId = 'swords-wizardry'
$diagnosticId = 'swords-wizardry-spell-diagnostics'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$dataRoot = [System.IO.Path]::GetFullPath($FoundryDataPath).TrimEnd('\')
$expectedDataSuffix = [System.IO.Path]::Combine('FoundryVTT', 'Data')

if (-not (Test-Path -LiteralPath $dataRoot -PathType Container)) {
  throw "Foundry data path does not exist: $dataRoot"
}
if (-not $dataRoot.EndsWith($expectedDataSuffix, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing unexpected Foundry data path: $dataRoot"
}

$systemSource = Join-Path $repositoryRoot "dist\$packageId"
$systemManifest = Join-Path $systemSource 'system.json'
Assert-PackageIdentity -ManifestPath $systemManifest -ExpectedId $packageId

$backupRoot = Join-Path $dataRoot '.codex-review-backups'
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$deployments = @()
$deployments += Install-ReviewPackage `
  -SourcePath $systemSource `
  -CollectionRoot (Join-Path $dataRoot 'systems') `
  -PackageId $packageId `
  -ManifestName 'system.json' `
  -BackupRoot $backupRoot `
  -Timestamp $timestamp

if ($IncludeDiagnostics) {
  $diagnosticSource = Join-Path $repositoryRoot 'tests\foundry\spell-diagnostics'
  Assert-PackageIdentity `
    -ManifestPath (Join-Path $diagnosticSource 'module.json') `
    -ExpectedId $diagnosticId
  $deployments += Install-ReviewPackage `
    -SourcePath $diagnosticSource `
    -CollectionRoot (Join-Path $dataRoot 'modules') `
    -PackageId $diagnosticId `
    -ManifestName 'module.json' `
    -BackupRoot $backupRoot `
    -Timestamp $timestamp
}

$deployments | Format-Table -AutoSize
