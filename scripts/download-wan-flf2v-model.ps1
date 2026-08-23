[CmdletBinding()]
param(
  [string]$ManifestPath,
  [string]$TargetDir,
  [string]$MirrorBase = '',
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$repositoryRoot = Join-Path $PSScriptRoot ".."
if ([string]::IsNullOrWhiteSpace($ManifestPath)) {
  $ManifestPath = Join-Path $repositoryRoot "src\modules\comfy-pipeline\presets\wan-flf2v-model-manifest.json"
}

$manifest = Get-Content -Raw -LiteralPath $ManifestPath | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace($manifest.fileName) -or [IO.Path]::GetFileName($manifest.fileName) -ne $manifest.fileName) {
  throw "Manifest fileName must be a file name without directory components"
}
if ([string]::IsNullOrWhiteSpace($manifest.downloadUrl) -or $manifest.sha256 -notmatch "^[0-9a-fA-F]{64}$") {
  throw "Manifest must contain a download URL and a SHA-256 hash"
}
$effectiveDownloadUrl = [string]$manifest.downloadUrl
if (-not [string]::IsNullOrWhiteSpace($MirrorBase)) {
  $sourceUri = [Uri]$effectiveDownloadUrl
  $mirrorUri = [Uri]$MirrorBase
  if (-not $mirrorUri.IsAbsoluteUri -or $mirrorUri.Scheme -ne 'https' -or $mirrorUri.AbsolutePath -ne '/' -or -not [string]::IsNullOrEmpty($mirrorUri.Query)) {
    throw "MirrorBase must be an HTTPS origin without a path or query"
  }
  if (-not $sourceUri.IsAbsoluteUri -or $sourceUri.Scheme -ne 'https' -or $sourceUri.Host -ne 'huggingface.co') {
    throw "MirrorBase may only replace the canonical huggingface.co origin"
  }
  $builder = [UriBuilder]$sourceUri
  $builder.Scheme = $mirrorUri.Scheme
  $builder.Host = $mirrorUri.Host
  $builder.Port = $mirrorUri.Port
  $effectiveDownloadUrl = $builder.Uri.AbsoluteUri
}
if ([string]::IsNullOrWhiteSpace($manifest.targetSubdirectory) -or [IO.Path]::GetFileName($manifest.targetSubdirectory) -ne $manifest.targetSubdirectory) {
  throw "Manifest targetSubdirectory must be a directory name without path components"
}

$manifestMinimumFreeBytes = $manifest.minimumFreeBytes
$isIntegralMinimum = $manifestMinimumFreeBytes -is [byte] -or $manifestMinimumFreeBytes -is [sbyte] -or `
  $manifestMinimumFreeBytes -is [int16] -or $manifestMinimumFreeBytes -is [uint16] -or `
  $manifestMinimumFreeBytes -is [int32] -or $manifestMinimumFreeBytes -is [uint32] -or `
  $manifestMinimumFreeBytes -is [int64] -or $manifestMinimumFreeBytes -is [uint64]
if ($null -eq $manifestMinimumFreeBytes -or -not $isIntegralMinimum) {
  throw "Manifest minimumFreeBytes must be a positive integral byte count"
}
try {
  $minimumFreeBytes = [int64]$manifestMinimumFreeBytes
} catch {
  throw "Manifest minimumFreeBytes must fit in a signed 64-bit integer"
}
if ($minimumFreeBytes -le 0) {
  throw "Manifest minimumFreeBytes must be a positive integral byte count"
}

if ([string]::IsNullOrWhiteSpace($TargetDir)) {
  $localAppData = [Environment]::GetEnvironmentVariable("LOCALAPPDATA")
  $sharedRoot = if ([string]::IsNullOrWhiteSpace($localAppData)) { $null } else { Join-Path $localAppData "Comfy-Desktop\ComfyUI-Shared" }
  if ($null -eq $sharedRoot -or -not (Test-Path -LiteralPath $sharedRoot -PathType Container)) {
    throw "No verified Comfy Desktop shared runtime root was found; provide -TargetDir explicitly"
  }
  $TargetDir = Join-Path $sharedRoot "models\$($manifest.targetSubdirectory)"
}

$finalPath = Join-Path $TargetDir $manifest.fileName
$partialPath = "$finalPath.part"
if ($DryRun) {
  [pscustomobject]@{ finalPath=$finalPath; partialPath=$partialPath; sha256=$manifest.sha256; downloadUrl=$effectiveDownloadUrl } | ConvertTo-Json
  exit 0
}

if (Test-Path -LiteralPath $finalPath) {
  $existing = (Get-FileHash -Algorithm SHA256 -LiteralPath $finalPath).Hash.ToLowerInvariant()
  if ($existing -eq $manifest.sha256.ToLowerInvariant()) {
    exit 0
  }
  throw "Existing FLF2V model SHA-256 mismatch; refusing to overwrite it"
}

$drive = Get-PSDrive -Name ([IO.Path]::GetPathRoot($TargetDir).TrimEnd(':\\'))
if ($drive.Free -lt $minimumFreeBytes) {
  throw "at least 25 GiB free space is required"
}

New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null
curl.exe --location --fail --retry 5 --continue-at - --output $partialPath $effectiveDownloadUrl
if ($LASTEXITCODE -ne 0) {
  throw "FLF2V model download failed"
}

$actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $partialPath).Hash.ToLowerInvariant()
if ($actual -ne $manifest.sha256.ToLowerInvariant()) {
  throw "FLF2V model SHA-256 mismatch"
}
Move-Item -LiteralPath $partialPath -Destination $finalPath
