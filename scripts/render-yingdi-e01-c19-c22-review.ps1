[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$C18Path,
  [Parameter(Mandatory = $true)][string]$C19Path,
  [Parameter(Mandatory = $true)][string]$C20Path,
  [Parameter(Mandatory = $true)][string]$C21Path,
  [Parameter(Mandatory = $true)][string]$C22Path,
  [Parameter(Mandatory = $true)][string]$C23Path,
  [Parameter(Mandatory = $true)][string]$OutputPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$inputs = @(
  [pscustomobject]@{ Label = 'C18'; Path = $C18Path },
  [pscustomobject]@{ Label = 'C19'; Path = $C19Path },
  [pscustomobject]@{ Label = 'C20'; Path = $C20Path },
  [pscustomobject]@{ Label = 'C21'; Path = $C21Path },
  [pscustomobject]@{ Label = 'C22'; Path = $C22Path },
  [pscustomobject]@{ Label = 'C23'; Path = $C23Path }
)

foreach ($input in $inputs) {
  if (-not [System.IO.Path]::IsPathRooted($input.Path)) { throw "$($input.Label) path must be absolute: $($input.Path)" }
  if (-not (Test-Path -LiteralPath $input.Path -PathType Leaf)) { throw "Missing review input $($input.Label): $($input.Path)" }
}
if (-not [System.IO.Path]::IsPathRooted($OutputPath)) { throw "Output path must be absolute: $OutputPath" }

$ffmpeg = if ([string]::IsNullOrWhiteSpace($env:FFMPEG_BIN)) { 'ffmpeg' } else { $env:FFMPEG_BIN }
if ($null -eq (Get-Command $ffmpeg -ErrorAction SilentlyContinue)) { throw "Bundled ffmpeg was not found: $ffmpeg. Set FFMPEG_BIN or add ffmpeg to PATH." }

$outputDirectory = [System.IO.Path]::GetDirectoryName($OutputPath)
if ([string]::IsNullOrWhiteSpace($outputDirectory)) { throw "Output path must have a parent directory: $OutputPath" }
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null

# Each source is contained inside a fixed panel: scale never enlarges beyond the panel,
# force_original_aspect_ratio=decrease never crops, and the title row is above the source pixels.
$panelFilters = [System.Collections.Generic.List[string]]::new()
for ($index = 0; $index -lt $inputs.Count; $index++) {
  $label = $inputs[$index].Label
  $panelFilters.Add("[$index`:v]scale=640:350:force_original_aspect_ratio=decrease,pad=640:350:(ow-iw)/2:(oh-ih)/2:color=0x101826,pad=640:400:0:50:color=0x101826,drawtext=text='$label':fontcolor=white:fontsize=24:x=20:y=16[v$index]")
}
$filter = ($panelFilters -join ';') + ';[v0][v1][v2]hstack=inputs=3[top];[v3][v4][v5]hstack=inputs=3[bottom];[top][bottom]vstack=inputs=2[contact]'

$arguments = [System.Collections.Generic.List[string]]::new()
foreach ($argument in @('-hide_banner', '-y')) { $arguments.Add([string]$argument) }
foreach ($input in $inputs) { $arguments.Add('-i'); $arguments.Add($input.Path) }
foreach ($argument in @('-filter_complex', $filter, '-map', '[contact]', '-frames:v', '1', '-c:v', 'png', '-pix_fmt', 'rgb24', $OutputPath)) { $arguments.Add([string]$argument) }
& $ffmpeg @arguments
if ($LASTEXITCODE -ne 0) { throw "ffmpeg failed with exit code $LASTEXITCODE" }
if (-not (Test-Path -LiteralPath $OutputPath -PathType Leaf)) { throw "ffmpeg did not create review sheet: $OutputPath" }

Write-Output "rendered=$OutputPath"
Write-Output 'order=C18,C19,C20,C21,C22,C23'
