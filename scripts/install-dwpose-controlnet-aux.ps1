param(
  [string]$ComfyRoot = 'C:\Users\Administrator\AppData\Local\Comfy-Desktop\ComfyUI-Installs\ComfyUI\ComfyUI',
  [string]$ComfyPython = 'C:\Users\Administrator\AppData\Local\Comfy-Desktop\ComfyUI-Installs\ComfyUI\ComfyUI\.venv\Scripts\python.exe',
  [string]$ManifestPath = '',
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ([string]::IsNullOrWhiteSpace($ManifestPath)) {
  $ManifestPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'src\modules\comfy-pipeline\presets\dwpose-install-manifest.json'
}
$ManifestPath = [System.IO.Path]::GetFullPath($ManifestPath)
if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) {
  throw "DWPose manifest is missing: $ManifestPath"
}

$manifest = Get-Content -Raw -LiteralPath $ManifestPath | ConvertFrom-Json
if ($manifest.schemaVersion -ne 1) { throw 'Unsupported DWPose manifest schema' }
if ($manifest.repository -ne 'https://github.com/Fannovel16/comfyui_controlnet_aux.git') { throw 'Unexpected DWPose repository' }
if ($manifest.commit -notmatch '^[0-9a-f]{40}$') { throw 'Invalid pinned DWPose commit' }
if ($manifest.nodeClass -ne 'DWPreprocessor') { throw 'Unexpected DWPose node class' }
if (@($manifest.models).Count -ne 2) { throw 'DWPose manifest must contain exactly two models' }

$plugin = Join-Path $ComfyRoot 'custom_nodes\comfyui_controlnet_aux'
$ckpts = Join-Path $plugin 'ckpts'
$requirementsPath = Join-Path $plugin 'requirements.txt'
$reportPath = Join-Path $plugin 'dwpose-install-report.json'

$modelPlan = @()
foreach ($model in @($manifest.models)) {
  if ($model.file -notmatch '^[A-Za-z0-9._-]+$') { throw "Invalid model filename: $($model.file)" }
  if ($model.relativePath -notmatch '^[A-Za-z0-9._/-]+$' -or $model.relativePath -match '(^|/)\.\.(/|$)' -or -not $model.relativePath.EndsWith("/$($model.file)")) {
    throw "Invalid model relative path: $($model.relativePath)"
  }
  if ($model.url -notmatch '^https://huggingface\.co/') { throw "Invalid model URL: $($model.url)" }
  if ($model.sha256 -notmatch '^[0-9a-f]{64}$') { throw "Invalid SHA-256 for $($model.file)" }
  $target = Join-Path $ckpts ($model.relativePath -replace '/', [System.IO.Path]::DirectorySeparatorChar)
  if (Test-Path -LiteralPath $target) {
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $target).Hash.ToLowerInvariant()
    if ($actual -ne $model.sha256) {
      throw "SHA-256 integrity failure for existing model $($model.file): expected $($model.sha256), got $actual"
    }
  }
  $modelPlan += [ordered]@{
    file = [string]$model.file
    relativePath = [string]$model.relativePath
    url = [string]$model.url
    sha256 = [string]$model.sha256
  }
}

$plan = [ordered]@{
  schemaVersion = 1
  dryRun = [bool]$DryRun
  repository = [string]$manifest.repository
  commit = [string]$manifest.commit
  nodeClass = [string]$manifest.nodeClass
  comfyRoot = [System.IO.Path]::GetFullPath($ComfyRoot)
  comfyPython = [System.IO.Path]::GetFullPath($ComfyPython)
  pluginPath = [System.IO.Path]::GetFullPath($plugin)
  requirementsPath = [System.IO.Path]::GetFullPath($requirementsPath)
  models = $modelPlan
}

if ($DryRun) {
  $plan | ConvertTo-Json -Depth 8
  exit 0
}

if (-not (Test-Path -LiteralPath $ComfyRoot -PathType Container)) { throw "ComfyUI root is missing: $ComfyRoot" }
if (-not (Test-Path -LiteralPath $ComfyPython -PathType Leaf)) { throw "ComfyUI Python is missing: $ComfyPython" }

if (-not (Test-Path -LiteralPath $plugin)) {
  $customNodes = Split-Path -Parent $plugin
  if (-not (Test-Path -LiteralPath $customNodes)) { New-Item -ItemType Directory -Path $customNodes | Out-Null }
  & git clone --no-checkout -- $manifest.repository $plugin
  if ($LASTEXITCODE -ne 0) { throw 'DWPose repository clone failed' }
} else {
  if (-not (Test-Path -LiteralPath (Join-Path $plugin '.git'))) { throw "Existing plugin path is not the pinned git repository: $plugin" }
  $remote = (& git -C $plugin remote get-url origin).Trim()
  if ($LASTEXITCODE -ne 0 -or $remote -ne $manifest.repository) { throw "Existing DWPose remote mismatch: $remote" }
}

& git -C $plugin cat-file -e "$($manifest.commit)^{commit}" 2>$null
if ($LASTEXITCODE -ne 0) {
  & git -C $plugin fetch --depth 1 origin $manifest.commit
  if ($LASTEXITCODE -ne 0) { throw 'Pinned DWPose commit fetch failed' }
}
& git -C $plugin checkout --detach $manifest.commit
if ($LASTEXITCODE -ne 0) { throw 'Pinned DWPose checkout failed' }
$actualCommit = (& git -C $plugin rev-parse HEAD).Trim()
if ($actualCommit -ne $manifest.commit) { throw "Pinned DWPose commit mismatch: $actualCommit" }

if (-not (Test-Path -LiteralPath $requirementsPath -PathType Leaf)) { throw "DWPose requirements.txt is missing: $requirementsPath" }
& $ComfyPython -s -m pip install -r $requirementsPath
if ($LASTEXITCODE -ne 0) { throw 'DWPose Python requirements installation failed' }

if (-not (Test-Path -LiteralPath $ckpts)) { New-Item -ItemType Directory -Path $ckpts | Out-Null }
$installedModels = @()
foreach ($model in @($manifest.models)) {
  $target = Join-Path $ckpts ($model.relativePath -replace '/', [System.IO.Path]::DirectorySeparatorChar)
  $targetDirectory = Split-Path -Parent $target
  if (-not (Test-Path -LiteralPath $targetDirectory)) { New-Item -ItemType Directory -Path $targetDirectory -Force | Out-Null }
  if (-not (Test-Path -LiteralPath $target)) {
    $partial = "$target.partial.$([guid]::NewGuid().ToString('N'))"
    try {
      Invoke-WebRequest -UseBasicParsing -Uri $model.url -OutFile $partial
      $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $partial).Hash.ToLowerInvariant()
      if ($actual -ne $model.sha256) { throw "SHA-256 integrity failure for downloaded model $($model.file)" }
      Move-Item -LiteralPath $partial -Destination $target
    } finally {
      if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial -Force }
    }
  }
  $finalHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $target).Hash.ToLowerInvariant()
  if ($finalHash -ne $model.sha256) { throw "Final SHA-256 integrity failure for $($model.file)" }
  $item = Get-Item -LiteralPath $target
  $installedModels += [ordered]@{ file = $model.file; path = $item.FullName; byteCount = $item.Length; sha256 = $finalHash }
}

$report = [ordered]@{
  schemaVersion = 1
  repository = [string]$manifest.repository
  commit = $actualCommit
  nodeClass = [string]$manifest.nodeClass
  pluginPath = [System.IO.Path]::GetFullPath($plugin)
  comfyPython = [System.IO.Path]::GetFullPath($ComfyPython)
  models = $installedModels
}
$reportTemp = "$reportPath.partial.$([guid]::NewGuid().ToString('N'))"
try {
  [System.IO.File]::WriteAllText($reportTemp, (($report | ConvertTo-Json -Depth 8) + [Environment]::NewLine), [System.Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $reportTemp -Destination $reportPath -Force
} finally {
  if (Test-Path -LiteralPath $reportTemp) { Remove-Item -LiteralPath $reportTemp -Force }
}

$report | ConvertTo-Json -Depth 8
