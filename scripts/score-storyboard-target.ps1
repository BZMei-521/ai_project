param(
  [Parameter(Mandatory = $true)]
  [string]$Target,
  [Parameter(Mandatory = $true)]
  [string]$Candidate
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $Target)) {
  throw "Target image not found: $Target"
}
if (-not (Test-Path -LiteralPath $Candidate)) {
  throw "Candidate image not found: $Candidate"
}

Add-Type -AssemblyName System.Drawing

function Get-BoxSimilarity {
  param(
    [System.Drawing.Bitmap]$A,
    [System.Drawing.Bitmap]$B,
    [double]$X0,
    [double]$Y0,
    [double]$X1,
    [double]$Y1
  )

  $w = $A.Width
  $h = $A.Height
  $sx0 = [int][Math]::Max(0, [Math]::Floor($X0 * $w))
  $sy0 = [int][Math]::Max(0, [Math]::Floor($Y0 * $h))
  $sx1 = [int][Math]::Min($w - 1, [Math]::Floor($X1 * $w))
  $sy1 = [int][Math]::Min($h - 1, [Math]::Floor($Y1 * $h))

  $sum = 0.0
  $count = 0
  for ($y = $sy0; $y -le $sy1; $y++) {
    for ($x = $sx0; $x -le $sx1; $x++) {
      $ca = $A.GetPixel($x, $y)
      $cb = $B.GetPixel($x, $y)
      $sum += ([Math]::Abs($ca.R - $cb.R) + [Math]::Abs($ca.G - $cb.G) + [Math]::Abs($ca.B - $cb.B)) / 3.0
      $count += 1
    }
  }
  if ($count -le 0) {
    return 0.0
  }
  return 1.0 - (($sum / $count) / 255.0)
}

$targetImage = New-Object System.Drawing.Bitmap($Target)
$candidateImageOriginal = New-Object System.Drawing.Bitmap($Candidate)
$candidateImage = $candidateImageOriginal
if ($targetImage.Width -ne $candidateImageOriginal.Width -or $targetImage.Height -ne $candidateImageOriginal.Height) {
  $candidateImage = New-Object System.Drawing.Bitmap($candidateImageOriginal, $targetImage.Width, $targetImage.Height)
  $candidateImageOriginal.Dispose()
}

try {
  $globalSim = Get-BoxSimilarity -A $targetImage -B $candidateImage -X0 0 -Y0 0 -X1 1 -Y1 1
  $femaleHeadSim = Get-BoxSimilarity -A $targetImage -B $candidateImage -X0 0.20 -Y0 0.10 -X1 0.37 -Y1 0.33
  $maleHeadSim = Get-BoxSimilarity -A $targetImage -B $candidateImage -X0 0.41 -Y0 0.08 -X1 0.58 -Y1 0.31
  $femaleBodySim = Get-BoxSimilarity -A $targetImage -B $candidateImage -X0 0.15 -Y0 0.18 -X1 0.42 -Y1 0.92
  $maleBodySim = Get-BoxSimilarity -A $targetImage -B $candidateImage -X0 0.35 -Y0 0.17 -X1 0.66 -Y1 0.95
  $femaleFaceDetailSim = Get-BoxSimilarity -A $targetImage -B $candidateImage -X0 0.25 -Y0 0.14 -X1 0.34 -Y1 0.28
  $maleFaceDetailSim = Get-BoxSimilarity -A $targetImage -B $candidateImage -X0 0.43 -Y0 0.12 -X1 0.54 -Y1 0.27
  $handHoldSim = Get-BoxSimilarity -A $targetImage -B $candidateImage -X0 0.36 -Y0 0.46 -X1 0.50 -Y1 0.66
  $torsoCenterSim = Get-BoxSimilarity -A $targetImage -B $candidateImage -X0 0.28 -Y0 0.26 -X1 0.60 -Y1 0.80
  $femaleFeetSim = Get-BoxSimilarity -A $targetImage -B $candidateImage -X0 0.18 -Y0 0.80 -X1 0.39 -Y1 0.99
  $maleFeetSim = Get-BoxSimilarity -A $targetImage -B $candidateImage -X0 0.45 -Y0 0.80 -X1 0.64 -Y1 0.99
  $poseArmSim = Get-BoxSimilarity -A $targetImage -B $candidateImage -X0 0.32 -Y0 0.38 -X1 0.56 -Y1 0.64
  $femaleEdgeLeftSim = Get-BoxSimilarity -A $targetImage -B $candidateImage -X0 0.14 -Y0 0.20 -X1 0.17 -Y1 0.92
  $femaleEdgeRightSim = Get-BoxSimilarity -A $targetImage -B $candidateImage -X0 0.39 -Y0 0.20 -X1 0.42 -Y1 0.92
  $maleEdgeLeftSim = Get-BoxSimilarity -A $targetImage -B $candidateImage -X0 0.35 -Y0 0.18 -X1 0.38 -Y1 0.95
  $maleEdgeRightSim = Get-BoxSimilarity -A $targetImage -B $candidateImage -X0 0.63 -Y0 0.18 -X1 0.66 -Y1 0.95
  $edgeBlendSim = ($femaleEdgeLeftSim + $femaleEdgeRightSim + $maleEdgeLeftSim + $maleEdgeRightSim) / 4.0

  $finalScore =
    0.04 * $globalSim +
    0.11 * $femaleHeadSim +
    0.11 * $maleHeadSim +
    0.10 * $femaleBodySim +
    0.10 * $maleBodySim +
    0.10 * $femaleFaceDetailSim +
    0.10 * $maleFaceDetailSim +
    0.09 * $handHoldSim +
    0.06 * $torsoCenterSim +
    0.05 * $femaleFeetSim +
    0.05 * $maleFeetSim +
    0.04 * $poseArmSim +
    0.05 * $edgeBlendSim

  [pscustomobject]@{
    score = [Math]::Round($finalScore, 4)
    global = [Math]::Round($globalSim, 4)
    female_head = [Math]::Round($femaleHeadSim, 4)
    male_head = [Math]::Round($maleHeadSim, 4)
    female_body = [Math]::Round($femaleBodySim, 4)
    male_body = [Math]::Round($maleBodySim, 4)
    female_face_detail = [Math]::Round($femaleFaceDetailSim, 4)
    male_face_detail = [Math]::Round($maleFaceDetailSim, 4)
    hand_hold = [Math]::Round($handHoldSim, 4)
    torso_center = [Math]::Round($torsoCenterSim, 4)
    female_feet = [Math]::Round($femaleFeetSim, 4)
    male_feet = [Math]::Round($maleFeetSim, 4)
    pose_arm = [Math]::Round($poseArmSim, 4)
    edge_blend = [Math]::Round($edgeBlendSim, 4)
    female_edge_left = [Math]::Round($femaleEdgeLeftSim, 4)
    female_edge_right = [Math]::Round($femaleEdgeRightSim, 4)
    male_edge_left = [Math]::Round($maleEdgeLeftSim, 4)
    male_edge_right = [Math]::Round($maleEdgeRightSim, 4)
  } | ConvertTo-Json -Compress
} finally {
  $targetImage.Dispose()
  $candidateImage.Dispose()
}
