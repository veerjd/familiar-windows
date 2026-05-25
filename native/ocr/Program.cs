// Familiar OCR helper — reads a PNG, runs Windows.Media.Ocr, emits JSON to stdout.
//
// Usage:   familiar-ocr.exe <image-path>
// Output:  {"lines":[{"text":"...","bbox":[x,y,w,h],"words":[{"text":"...","bbox":[x,y,w,h],"confidence":0.0}]}]}
// Exit:    0 = success, 1 = bad args, 2 = engine unavailable, 3 = decode/IO error

using System.Text;
using System.Text.Json;
using Windows.Globalization;
using Windows.Graphics.Imaging;
using Windows.Media.Ocr;
using Windows.Storage;
using Windows.Storage.Streams;

if (args.Length < 1)
{
    Console.Error.WriteLine("usage: familiar-ocr.exe <image-path>");
    return 1;
}

var imagePath = args[0];
if (!File.Exists(imagePath))
{
    Console.Error.WriteLine($"image not found: {imagePath}");
    return 3;
}

// Prefer user-profile languages; fall back to en-US if that returns null
// (e.g. on a fresh image with no OCR language packs matching the UI locale).
var engine = OcrEngine.TryCreateFromUserProfileLanguages()
             ?? OcrEngine.TryCreateFromLanguage(new Language("en-US"));
if (engine is null)
{
    Console.Error.WriteLine("Windows.Media.Ocr engine unavailable for installed languages");
    return 2;
}

SoftwareBitmap bitmap;
try
{
    var file = await StorageFile.GetFileFromPathAsync(imagePath);
    using var stream = await file.OpenAsync(FileAccessMode.Read);
    var decoder = await BitmapDecoder.CreateAsync(stream);
    bitmap = await decoder.GetSoftwareBitmapAsync();
}
catch (Exception ex)
{
    Console.Error.WriteLine($"decode failed: {ex.Message}");
    return 3;
}

OcrResult result;
try
{
    result = await engine.RecognizeAsync(bitmap);
}
catch (Exception ex)
{
    Console.Error.WriteLine($"ocr failed: {ex.Message}");
    return 3;
}

// Build minimal JSON manually so the trimmed AOT publish stays small and we
// don't pay for System.Text.Json reflection metadata on POCO serialization.
var sb = new StringBuilder(8 * 1024);
sb.Append("{\"lines\":[");
for (var li = 0; li < result.Lines.Count; li++)
{
    var line = result.Lines[li];
    if (li > 0) sb.Append(',');

    // Line bbox = union of word bboxes.
    double minX = double.MaxValue, minY = double.MaxValue, maxX = 0, maxY = 0;
    foreach (var w in line.Words)
    {
        var r = w.BoundingRect;
        if (r.X < minX) minX = r.X;
        if (r.Y < minY) minY = r.Y;
        if (r.X + r.Width > maxX) maxX = r.X + r.Width;
        if (r.Y + r.Height > maxY) maxY = r.Y + r.Height;
    }
    if (line.Words.Count == 0) { minX = minY = 0; maxX = maxY = 0; }

    sb.Append("{\"text\":");
    AppendJsonString(sb, line.Text);
    sb.Append(",\"bbox\":[")
      .Append((int)minX).Append(',')
      .Append((int)minY).Append(',')
      .Append((int)(maxX - minX)).Append(',')
      .Append((int)(maxY - minY))
      .Append("],\"words\":[");
    for (var wi = 0; wi < line.Words.Count; wi++)
    {
        var w = line.Words[wi];
        if (wi > 0) sb.Append(',');
        var r = w.BoundingRect;
        sb.Append("{\"text\":");
        AppendJsonString(sb, w.Text);
        sb.Append(",\"bbox\":[")
          .Append((int)r.X).Append(',')
          .Append((int)r.Y).Append(',')
          .Append((int)r.Width).Append(',')
          .Append((int)r.Height)
          .Append("]}");
        // Note: Windows.Media.Ocr does NOT expose per-word confidence in the
        // public API — only `OcrResult.TextAngle` and the bounding rects. We
        // emit no confidence field; the JS side treats missing as "unknown"
        // and skips the confidence filter for native results.
    }
    sb.Append("]}");
}
sb.Append("]}");

Console.OutputEncoding = Encoding.UTF8;
Console.Out.Write(sb.ToString());
return 0;

static void AppendJsonString(StringBuilder sb, string s)
{
    sb.Append('"');
    foreach (var c in s)
    {
        switch (c)
        {
            case '"': sb.Append("\\\""); break;
            case '\\': sb.Append("\\\\"); break;
            case '\b': sb.Append("\\b"); break;
            case '\f': sb.Append("\\f"); break;
            case '\n': sb.Append("\\n"); break;
            case '\r': sb.Append("\\r"); break;
            case '\t': sb.Append("\\t"); break;
            default:
                if (c < 0x20) sb.Append($"\\u{(int)c:x4}");
                else sb.Append(c);
                break;
        }
    }
    sb.Append('"');
}
