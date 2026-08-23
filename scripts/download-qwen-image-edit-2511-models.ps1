[CmdletBinding()]
param(
  [string]$ManifestPath = '',
  [Parameter(Mandatory = $true)]
  [string]$ModelsRoot,
  [string]$MirrorBase = '',
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($ManifestPath)) {
  $ManifestPath = Join-Path $PSScriptRoot '..\src\modules\comfy-pipeline\presets\qwen-image-edit-2511-model-manifest.json'
}

function Get-Sha256Lower([string]$Path) {
  return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}

function Assert-SafeRelativeDirectory([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value) -or [IO.Path]::IsPathRooted($Value)) {
    throw "targetSubdirectory must be a non-empty relative directory"
  }
  $segments = $Value -split '[\\/]'
  if ($segments -contains '..' -or $segments -contains '.') {
    throw "targetSubdirectory must not contain traversal segments"
  }
}

$resolvedManifest = [IO.Path]::GetFullPath($ManifestPath)
$resolvedRoot = [IO.Path]::GetFullPath($ModelsRoot)
$manifest = Get-Content -Raw -LiteralPath $resolvedManifest | ConvertFrom-Json
if ($manifest.schemaVersion -ne 1 -or $null -eq $manifest.files -or $manifest.files.Count -lt 1) {
  throw "Unsupported Qwen model manifest"
}

$mirrorUri = $null
if (-not [string]::IsNullOrWhiteSpace($MirrorBase)) {
  $mirrorUri = [Uri]$MirrorBase
  if (-not $mirrorUri.IsAbsoluteUri -or $mirrorUri.Scheme -ne 'https' -or $mirrorUri.AbsolutePath -ne '/' -or -not [string]::IsNullOrEmpty($mirrorUri.Query)) {
    throw "MirrorBase must be an HTTPS origin without a path or query"
  }
}

$items = @()
foreach ($file in $manifest.files) {
  Assert-SafeRelativeDirectory ([string]$file.targetSubdirectory)
  $fileName = [string]$file.fileName
  if ([string]::IsNullOrWhiteSpace($fileName) -or $fileName -ne [IO.Path]::GetFileName($fileName)) {
    throw "fileName must be a plain file name"
  }
  $sha256 = ([string]$file.sha256).ToLowerInvariant()
  if ($sha256 -notmatch '^[0-9a-f]{64}$') { throw "manifest SHA-256 is invalid for $fileName" }
  $byteSize = [int64]$file.byteSize
  if ($byteSize -lt 1) { throw "manifest byteSize is invalid for $fileName" }
  $sourceUri = [Uri]([string]$file.downloadUrl)
  if (-not $sourceUri.IsAbsoluteUri -or @('https', 'file') -notcontains $sourceUri.Scheme) { throw "downloadUrl scheme is invalid for $fileName" }
  $effectiveUrl = $sourceUri.AbsoluteUri
  if ($null -ne $mirrorUri) {
    if ($sourceUri.Scheme -ne 'https' -or $sourceUri.Host -ne 'huggingface.co') {
      throw "MirrorBase may only replace the canonical huggingface.co origin"
    }
    $builder = [UriBuilder]$sourceUri
    $builder.Scheme = $mirrorUri.Scheme
    $builder.Host = $mirrorUri.Host
    $builder.Port = $mirrorUri.Port
    $effectiveUrl = $builder.Uri.AbsoluteUri
  }
  $targetDirectory = [IO.Path]::GetFullPath((Join-Path $resolvedRoot ([string]$file.targetSubdirectory)))
  $rootPrefix = $resolvedRoot.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  if (-not $targetDirectory.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "target path escaped ModelsRoot"
  }
  $finalPath = Join-Path $targetDirectory $fileName
  $items += [pscustomobject]@{
    fileName = $fileName
    downloadUrl = $effectiveUrl
    sha256 = $sha256
    byteSize = $byteSize
    targetDirectory = $targetDirectory
    finalPath = $finalPath
    partialPath = "$finalPath.part"
  }
}

if ($DryRun) {
  [pscustomobject]@{
    modelsRoot = $resolvedRoot
    requiredDownloadBytes = [int64](($items | Measure-Object -Property byteSize -Sum).Sum)
    files = @($items | Select-Object fileName, byteSize, sha256, downloadUrl, finalPath, partialPath)
  } | ConvertTo-Json -Depth 5
  exit 0
}

$missingBytes = [int64]0
foreach ($item in $items) {
  if (Test-Path -LiteralPath $item.finalPath) {
    $existing = Get-Item -LiteralPath $item.finalPath
    if ($existing.Length -ne $item.byteSize -or (Get-Sha256Lower $item.finalPath) -ne $item.sha256) {
      throw "Existing final model is invalid and will not be overwritten: $($item.finalPath)"
    }
  } else {
    $partialBytes = if (Test-Path -LiteralPath $item.partialPath) { (Get-Item -LiteralPath $item.partialPath).Length } else { 0 }
    if ($partialBytes -gt $item.byteSize) { throw "Partial model is larger than the manifest size: $($item.partialPath)" }
    $missingBytes += ($item.byteSize - $partialBytes)
  }
}

$driveRoot = [IO.Path]::GetPathRoot($resolvedRoot)
$available = [int64]([IO.DriveInfo]::new($driveRoot).AvailableFreeSpace)
$reserve = [int64]$manifest.minimumFreeBytesAfterDownload
if ($available -lt ($missingBytes + $reserve)) {
  throw "Insufficient disk space: need $missingBytes download bytes plus $reserve reserve bytes, available $available"
}

foreach ($item in $items) {
  if (Test-Path -LiteralPath $item.finalPath) {
    Write-Output "Verified existing $($item.fileName)"
    continue
  }
  New-Item -ItemType Directory -Path $item.targetDirectory -Force | Out-Null
  & curl.exe --location --fail --retry 5 --continue-at - --output $item.partialPath $item.downloadUrl
  if ($LASTEXITCODE -ne 0) { throw "Download failed for $($item.fileName) with curl exit $LASTEXITCODE" }
  $partial = Get-Item -LiteralPath $item.partialPath
  if ($partial.Length -ne $item.byteSize) {
    throw "Downloaded byte count mismatch for $($item.fileName): expected $($item.byteSize), got $($partial.Length)"
  }
  $actual = Get-Sha256Lower $item.partialPath
  if ($actual -ne $item.sha256) { throw "SHA-256 mismatch for $($item.fileName)" }
  Move-Item -LiteralPath $item.partialPath -Destination $item.finalPath
  Write-Output "Installed $($item.fileName)"
}

[pscustomobject]@{
  status = 'verified'
  files = @($items | ForEach-Object { [pscustomobject]@{ path = $_.finalPath; byteSize = $_.byteSize; sha256 = $_.sha256 } })
} | ConvertTo-Json -Depth 5
