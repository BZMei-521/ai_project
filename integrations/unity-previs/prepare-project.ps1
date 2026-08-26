param(
  [string]$ProjectPath = 'C:\Users\Administrator\Desktop\小说\应用项目\Unity预演试验-20260826'
)
$ErrorActionPreference = 'Stop'
$allowedRoot = [IO.Path]::GetFullPath('C:\Users\Administrator\Desktop\小说\应用项目')
$resolvedProject = [IO.Path]::GetFullPath($ProjectPath)
if (-not $resolvedProject.StartsWith($allowedRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Project must be a child of the approved application project directory.' }
$utf8 = New-Object Text.UTF8Encoding($false)
foreach ($dir in @('Assets/Previs/Runtime','Assets/Previs/Editor','Assets/Previs/Resources','Packages','ProjectSettings','Logs')) {
  New-Item -ItemType Directory -Path (Join-Path $resolvedProject $dir) -Force | Out-Null
}
foreach ($pair in @(@('Runtime','Assets/Previs/Runtime'), @('Editor','Assets/Previs/Editor'), @('Shaders','Assets/Previs/Resources'))) {
  $sourceDir = Join-Path $PSScriptRoot $pair[0]
  if (Test-Path -LiteralPath $sourceDir) {
    Get-ChildItem -LiteralPath $sourceDir -File | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path (Join-Path $resolvedProject $pair[1]) $_.Name) -Force }
  }
}
$manifest = '{"dependencies":{"com.unity.modules.imageconversion":"1.0.0","com.unity.modules.imgui":"1.0.0","com.unity.modules.jsonserialize":"1.0.0","com.unity.modules.physics":"1.0.0"}}'
$manifestPath = Join-Path $resolvedProject 'Packages/manifest.json'
if (-not (Test-Path -LiteralPath $manifestPath)) { [IO.File]::WriteAllText($manifestPath, $manifest, $utf8) }
$versionPath = Join-Path $resolvedProject 'ProjectSettings/ProjectVersion.txt'
if (-not (Test-Path -LiteralPath $versionPath)) { [IO.File]::WriteAllText($versionPath, "m_EditorVersion: 2022.3.62f1c1`nm_EditorVersionWithRevision: 2022.3.62f1c1 (b0109b07edb8)`n", $utf8) }
Write-Output $resolvedProject
