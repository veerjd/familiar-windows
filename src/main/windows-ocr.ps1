param([string]$ImagePath)

Add-Type -AssemblyName System.Runtime.WindowsRuntime

function AwaitRT {
    param($Task, $Type)
    $methods = [System.WindowsRuntimeSystemExtensions].GetMethods()
    $generic = $methods | Where-Object {
        $_.Name -eq 'AsTask' -and
        $_.GetParameters().Count -eq 1 -and
        $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    } | Select-Object -First 1
    $net = $generic.MakeGenericMethod($Type).Invoke($null, @($Task))
    $net.Wait(-1) | Out-Null
    $net.Result
}

[void][Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
[void][Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
[void][Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]

$absPath = [System.IO.Path]::GetFullPath($ImagePath)
$file    = AwaitRT ([Windows.Storage.StorageFile]::GetFileFromPathAsync($absPath)) ([Windows.Storage.StorageFile])
$stream  = AwaitRT ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = AwaitRT ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap  = AwaitRT ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])

$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if (-not $engine) { exit 0 }

$result = AwaitRT ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
($result.Lines | ForEach-Object { $_.Text }) -join "`n"
