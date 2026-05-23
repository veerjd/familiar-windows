# Generates a multi-resolution .ico from src/assets/familiar.png.
# Writes 16, 24, 32, 48, 64, 128, 256 PNG-encoded entries — electron-builder
# requires at least one 256x256 entry. Run once after replacing familiar.png.

param(
  [string]$Source = "src/assets/familiar.png",
  [string]$Target = "src/assets/familiar.ico"
)

Add-Type -AssemblyName System.Drawing

$sizes = 16, 24, 32, 48, 64, 128, 256
[System.Drawing.Image]$source = [System.Drawing.Image]::FromFile((Resolve-Path $Source))

try {
  # Render each size into a PNG-encoded byte array.
  $entries = New-Object System.Collections.ArrayList
  foreach ($size in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.DrawImage($source, 0, 0, $size, $size)
    $g.Dispose()
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    [void]$entries.Add([PSCustomObject]@{ Size = $size; Bytes = $ms.ToArray() })
  }

  # Build ICONDIR (6 bytes) + ICONDIRENTRY array (16 bytes each) + image payloads.
  $outStream = New-Object System.IO.MemoryStream
  $writer = New-Object System.IO.BinaryWriter($outStream)

  # ICONDIR
  $writer.Write([UInt16]0)                  # reserved
  $writer.Write([UInt16]1)                  # type: 1 = icon
  $writer.Write([UInt16]$entries.Count)     # image count

  $headerSize = 6 + (16 * $entries.Count)
  $offset = $headerSize

  # ICONDIRENTRYs
  foreach ($e in $entries) {
    $w = if ($e.Size -ge 256) { 0 } else { [byte]$e.Size }   # 0 means 256
    $h = if ($e.Size -ge 256) { 0 } else { [byte]$e.Size }
    $writer.Write([byte]$w)                # width
    $writer.Write([byte]$h)                # height
    $writer.Write([byte]0)                 # color palette count (0 for non-palette)
    $writer.Write([byte]0)                 # reserved
    $writer.Write([UInt16]1)               # color planes
    $writer.Write([UInt16]32)              # bits per pixel
    $writer.Write([UInt32]$e.Bytes.Length) # size in bytes
    $writer.Write([UInt32]$offset)         # offset to image data
    $offset += $e.Bytes.Length
  }

  # Image payloads (PNG-encoded)
  foreach ($e in $entries) {
    $writer.Write($e.Bytes)
  }

  $writer.Flush()
  [System.IO.File]::WriteAllBytes((Resolve-Path -Path $Target -Relative -ErrorAction SilentlyContinue), $outStream.ToArray())
  if (-not (Test-Path $Target)) {
    [System.IO.File]::WriteAllBytes($Target, $outStream.ToArray())
  }
  $writer.Dispose()

  Write-Host "Wrote $Target with $($entries.Count) entries: $($sizes -join ', ')"
} finally {
  $source.Dispose()
}
