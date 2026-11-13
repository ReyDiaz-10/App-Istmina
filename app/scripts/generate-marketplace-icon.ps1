Add-Type -AssemblyName System.Drawing

$outputDir = Join-Path $PSScriptRoot '..\assets\images'
$size = 1024

function Draw-GroceryBag($graphics) {
  $brown = [System.Drawing.Color]::FromArgb(255, 153, 91, 48)
  $darkBrown = [System.Drawing.Color]::FromArgb(255, 105, 58, 33)
  $green = [System.Drawing.Color]::FromArgb(255, 52, 133, 72)
  $lightGreen = [System.Drawing.Color]::FromArgb(255, 107, 176, 87)
  $red = [System.Drawing.Color]::FromArgb(255, 222, 74, 57)
  $yellow = [System.Drawing.Color]::FromArgb(255, 248, 190, 63)
  $cream = [System.Drawing.Color]::FromArgb(255, 255, 245, 224)

  $handlePen = [System.Drawing.Pen]::new([System.Drawing.SolidBrush]::new($darkBrown), 34)
  $handlePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $handlePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $graphics.DrawArc($handlePen, 356, 246, 312, 302, 180, 180)

  $graphics.FillEllipse([System.Drawing.SolidBrush]::new($green), 357, 282, 136, 143)
  $graphics.FillEllipse([System.Drawing.SolidBrush]::new($lightGreen), 397, 250, 119, 137)
  $graphics.FillEllipse([System.Drawing.SolidBrush]::new($green), 457, 270, 135, 141)
  $graphics.FillEllipse([System.Drawing.SolidBrush]::new($lightGreen), 519, 254, 116, 143)
  $graphics.FillEllipse([System.Drawing.SolidBrush]::new($green), 577, 283, 98, 125)

  $carton = [System.Drawing.Point[]]@(
    [System.Drawing.Point]::new(451, 300), [System.Drawing.Point]::new(476, 269),
    [System.Drawing.Point]::new(553, 269), [System.Drawing.Point]::new(578, 300),
    [System.Drawing.Point]::new(578, 438), [System.Drawing.Point]::new(451, 438)
  )
  $graphics.FillPolygon([System.Drawing.SolidBrush]::new($cream), $carton)
  $graphics.FillRectangle([System.Drawing.SolidBrush]::new($yellow), 451, 370, 127, 68)
  $graphics.FillEllipse([System.Drawing.SolidBrush]::new($red), 587, 320, 105, 112)
  $graphics.FillEllipse([System.Drawing.SolidBrush]::new($green), 623, 300, 39, 34)

  $bag = [System.Drawing.Point[]]@(
    [System.Drawing.Point]::new(258, 390), [System.Drawing.Point]::new(766, 390),
    [System.Drawing.Point]::new(705, 799), [System.Drawing.Point]::new(321, 799)
  )
  $graphics.FillPolygon([System.Drawing.SolidBrush]::new($brown), $bag)
  $rim = [System.Drawing.Pen]::new([System.Drawing.SolidBrush]::new($darkBrown), 20)
  $graphics.DrawLine($rim, 269, 402, 755, 402)

  $fold = [System.Drawing.Point[]]@(
    [System.Drawing.Point]::new(280, 405), [System.Drawing.Point]::new(744, 405),
    [System.Drawing.Point]::new(693, 487), [System.Drawing.Point]::new(332, 487)
  )
  $graphics.FillPolygon([System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 184, 119, 70)), $fold)
  $graphics.DrawLine([System.Drawing.Pen]::new([System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(150, 87, 52, 31)), 9), 512, 493, 512, 751)
  $graphics.FillEllipse([System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 255, 231, 190)), 473, 577, 78, 78)
  $graphics.DrawArc([System.Drawing.Pen]::new([System.Drawing.SolidBrush]::new($brown), 12), 490, 594, 44, 42, 210, 120)
}

function New-Canvas($path, $background, $withCircle) {
  $bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.Clear([System.Drawing.Color]::Transparent)
  if ($background) {
    $graphics.Clear([System.Drawing.Color]::FromArgb(255, 245, 124, 0))
  }
  if ($withCircle) {
    $graphics.FillEllipse([System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 255, 244, 226)), 86, 86, 852, 852)
  }
  Draw-GroceryBag $graphics
  $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose()
  $bitmap.Dispose()
}

New-Canvas (Join-Path $outputDir 'istmiya-marketplace-icon.png') $true $true
New-Canvas (Join-Path $outputDir 'istmiya-adaptive-foreground.png') $false $false

$background = [System.Drawing.Bitmap]::new($size, $size)
$graphics = [System.Drawing.Graphics]::FromImage($background)
$graphics.Clear([System.Drawing.Color]::FromArgb(255, 245, 124, 0))
$background.Save((Join-Path $outputDir 'istmiya-adaptive-background.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$background.Dispose()
