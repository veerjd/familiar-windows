using System;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using Windows.Globalization;
using Windows.Graphics.Imaging;
using Windows.Media.Ocr;
using Windows.Storage;
using Windows.Storage.Streams;

namespace FamiliarOcr;

internal static class Program
{
    private static async Task<int> Main(string[] args)
    {
        if (args.Length < 1)
        {
            Console.Error.WriteLine("usage: FamiliarOcr <image-path>");
            return 2;
        }

        var imagePath = Path.GetFullPath(args[0]);
        if (!File.Exists(imagePath))
        {
            Console.Error.WriteLine($"file not found: {imagePath}");
            return 3;
        }

        try
        {
            var file = await StorageFile.GetFileFromPathAsync(imagePath);
            using IRandomAccessStream stream = await file.OpenAsync(FileAccessMode.Read);
            var decoder = await BitmapDecoder.CreateAsync(stream);

            // Upscale 2x with Fant interpolation before OCR. UI screenshots are
            // small for Windows.Media.Ocr (designed for ~300dpi docs); doubling
            // resolution materially improves accuracy on small UI text.
            // Cap the upscale so giant 4K+ multi-monitor stitches don't blow up
            // memory or hit OcrEngine.MaxImageDimension (~25 megapixels).
            const uint MaxDimension = 8192;
            uint targetW = decoder.PixelWidth * 2;
            uint targetH = decoder.PixelHeight * 2;
            if (targetW > MaxDimension || targetH > MaxDimension)
            {
                double scale = Math.Min((double)MaxDimension / decoder.PixelWidth,
                                        (double)MaxDimension / decoder.PixelHeight);
                targetW = (uint)(decoder.PixelWidth * scale);
                targetH = (uint)(decoder.PixelHeight * scale);
            }

            var transform = new BitmapTransform
            {
                ScaledWidth = targetW,
                ScaledHeight = targetH,
                InterpolationMode = BitmapInterpolationMode.Fant,
            };

            using var bitmap = await decoder.GetSoftwareBitmapAsync(
                BitmapPixelFormat.Bgra8,
                BitmapAlphaMode.Premultiplied,
                transform,
                ExifOrientationMode.RespectExifOrientation,
                ColorManagementMode.DoNotColorManage);

            var engine = OcrEngine.TryCreateFromUserProfileLanguages()
                         ?? OcrEngine.TryCreateFromLanguage(new Language("en-US"));
            if (engine is null)
            {
                Console.Error.WriteLine("No OCR engine available for installed languages.");
                return 4;
            }

            var result = await engine.RecognizeAsync(bitmap);
            var sb = new StringBuilder(result.Text.Length + 64);
            foreach (var line in result.Lines)
            {
                sb.AppendLine(line.Text);
            }
            Console.Out.Write(sb.ToString());
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"OCR error: {ex.GetType().Name}: {ex.Message}");
            return 1;
        }
    }
}
