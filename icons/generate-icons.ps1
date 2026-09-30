# たびわり アイコン生成（Node/Python不要、.NET System.Drawing のみ）
# 使い方: powershell -ExecutionPolicy Bypass -File icons/generate-icons.ps1
# 他の自作アプリと角丸の形・余白をそろえ、色と中の記号だけ変えている。
# 記号：コインがまっぷたつに割れている（＝割り勘）
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $MyInvocation.MyCommand.Path

function RoundRect($x, $y, $w, $h, $r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

$bg = [System.Drawing.Color]::FromArgb(255, 0xFF, 0xC9, 0x40)   # --sun
$fg = [System.Drawing.Color]::FromArgb(255, 0x1B, 0x1C, 0x1E)   # --ink

function Draw-Symbol($g, [single]$size, $brush, [single]$scale) {
  $r   = $size * 0.27 * $scale
  $cx  = $size * 0.5
  $cy  = $size * 0.5
  $gap = $size * 0.035 * $scale
  $dy  = $size * 0.03 * $scale
  # 左半分（少し上へ）・右半分（少し下へ）
  $g.FillPie($brush, [single]($cx - $r - $gap), [single]($cy - $r - $dy), [single]($r * 2), [single]($r * 2), 90, 180)
  $g.FillPie($brush, [single]($cx - $r + $gap), [single]($cy - $r + $dy), [single]($r * 2), [single]($r * 2), 270, 180)
  # コインのふちの内側の線（大きいサイズのときだけ）
  if ($size -ge 128) {
    $pen = New-Object System.Drawing.Pen($bg, [single]($size * 0.018 * $scale))
    $ri = $r * 0.72
    $g.DrawArc($pen, [single]($cx - $ri - $gap), [single]($cy - $ri - $dy), [single]($ri * 2), [single]($ri * 2), 100, 160)
    $g.DrawArc($pen, [single]($cx - $ri + $gap), [single]($cy - $ri + $dy), [single]($ri * 2), [single]($ri * 2), 280, 160)
    $pen.Dispose()
  }
}

function New-Icon([int]$size, [string]$path, [bool]$square, [single]$scale = 1.0) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $bgBrush = New-Object System.Drawing.SolidBrush($bg)
  if ($square) {
    $g.FillRectangle($bgBrush, 0, 0, $size, $size)
  } else {
    $g.FillPath($bgBrush, (RoundRect 0 0 $size $size ([int]($size * 0.22))))
  }
  $fgBrush = New-Object System.Drawing.SolidBrush($fg)
  Draw-Symbol $g ([single]$size) $fgBrush $scale
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bmp.Dispose()
}

New-Icon -size 192 -path (Join-Path $root "icon-192.png") -square $false
New-Icon -size 512 -path (Join-Path $root "icon-512.png") -square $false
New-Icon -size 512 -path (Join-Path $root "icon-maskable-512.png") -square $true -scale 0.8
New-Icon -size 180 -path (Join-Path $root "icon-180.png") -square $true
New-Icon -size 32  -path (Join-Path $root "favicon-32.png") -square $false

Write-Host "Icons generated in $root"
