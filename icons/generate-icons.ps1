# たびわり アイコン生成（Node/Python不要、.NET System.Drawing のみ）
# 使い方: powershell -ExecutionPolicy Bypass -File icons/generate-icons.ps1
# 他の自作アプリと角丸の形・余白をそろえ、色と中の記号だけ変えている。
# 記号：お札（真ん中に¥）を3枚に等しく切り分け、少しずつずらした形（＝お金を等分する）
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $MyInvocation.MyCommand.Path

function C($hex) { return [System.Drawing.ColorTranslator]::FromHtml($hex) }
function RoundRect([single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

$bg   = '#FFC940'   # --sun
$note = '#FFFFFF'   # お札
$line = '#E3AE2B'   # お札の内側の枠
$seal = '#1B1C1E'   # 真ん中の丸（--ink）
$yen  = '#FFC940'

function Draw-Symbol($g, [single]$S, [single]$scale) {
  $W = $S * 0.74 * $scale; $H = $S * 0.44 * $scale
  $n = 3
  $gap = $S * 0.032 * $scale
  $shift = $S * 0.035 * $scale
  $x0 = ($S - $W) / 2; $y0 = ($S - $H) / 2
  $part = $W / $n
  # 切り分けて隙間を空けた分だけ全体が広がるので、左に寄せて真ん中に置く
  $startX = $x0 - $gap * ($n - 1) / 2
  for ($i = 0; $i -lt $n; $i++) {
    $srcX = $x0 + $i * $part
    $dx = ($startX + $i * ($part + $gap)) - $srcX
    $dy = @($shift, 0, -$shift)[$i]
    $g.ResetTransform(); $g.ResetClip()
    $g.TranslateTransform([single]$dx, [single]$dy)
    $g.SetClip((New-Object System.Drawing.RectangleF([single]$srcX, [single]0, [single]$part, [single]$S)))
    $g.FillPath((New-Object System.Drawing.SolidBrush (C $note)), (RoundRect $x0 $y0 $W $H ($S * 0.045 * $scale)))
    if ($S -ge 64) {
      $pen = New-Object System.Drawing.Pen((C $line), [single]($S * 0.014 * $scale))
      $in = $S * 0.04 * $scale
      $g.DrawPath($pen, (RoundRect ($x0 + $in) ($y0 + $in) ($W - 2 * $in) ($H - 2 * $in) ($S * 0.025 * $scale)))
      $pen.Dispose()
    }
    $r = $S * 0.105 * $scale
    $g.FillEllipse((New-Object System.Drawing.SolidBrush (C $seal)), [single]($S / 2 - $r), [single]($S / 2 - $r), [single]($r * 2), [single]($r * 2))
    $font = New-Object System.Drawing.Font('Arial', [single]($S * 0.15 * $scale), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = 'Center'; $sf.LineAlignment = 'Center'
    $g.DrawString([string][char]0x00A5, $font, (New-Object System.Drawing.SolidBrush (C $yen)), (New-Object System.Drawing.RectangleF([single]0, [single]($S * 0.01 * $scale), [single]$S, [single]$S)), $sf)
  }
  $g.ResetTransform(); $g.ResetClip()
}

function New-Icon([int]$size, [string]$path, [bool]$square, [single]$scale = 1.0) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $bgBrush = New-Object System.Drawing.SolidBrush((C $bg))
  if ($square) {
    # iOS のホーム画面は自分で角を丸めるので、apple-touch-icon とマスク用は四角のまま
    $g.FillRectangle($bgBrush, 0, 0, $size, $size)
  } else {
    $g.FillPath($bgBrush, (RoundRect 0 0 $size $size ($size * 0.22)))
  }
  Draw-Symbol $g ([single]$size) $scale
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
