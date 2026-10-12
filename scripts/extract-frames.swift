// Extrait les images d’une vidéo (outil de développement, macOS).
// Usage : swift scripts/extract-frames.swift <vidéo> <dossier> <images/s> <largeur>
// Écrit pour chaque image : NNNN.rgba (RGBA brut) et NNNN.jpg (aperçu), plus meta.json.
import AVFoundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers
import Foundation

let args = CommandLine.arguments
let url = URL(fileURLWithPath: args[1])
let out = URL(fileURLWithPath: args[2])
let fps = Double(args[3])!
let width = Int(args[4])!

let asset = AVURLAsset(url: url)
let gen = AVAssetImageGenerator(asset: asset)
gen.appliesPreferredTrackTransform = true
gen.requestedTimeToleranceBefore = .zero
gen.requestedTimeToleranceAfter = .zero
gen.maximumSize = CGSize(width: width, height: width * 4)

let duration = CMTimeGetSeconds(asset.duration)
var t = 0.0
var i = 0
var w = 0, h = 0
while t < duration {
  let time = CMTime(seconds: t, preferredTimescale: 600)
  if let img = try? gen.copyCGImage(at: time, actualTime: nil) {
    w = img.width; h = img.height
    var buf = [UInt8](repeating: 0, count: w * h * 4)
    let ctx = CGContext(data: &buf, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
    let name = String(format: "%04d", i)
    try! Data(buf).write(to: out.appendingPathComponent(name + ".rgba"))
    let dest = CGImageDestinationCreateWithURL(out.appendingPathComponent(name + ".jpg") as CFURL, UTType.jpeg.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(dest, img, [kCGImageDestinationLossyCompressionQuality: 0.8] as CFDictionary)
    CGImageDestinationFinalize(dest)
  }
  i += 1
  t += 1.0 / fps
}
let meta = "{\"width\":\(w),\"height\":\(h),\"fps\":\(fps),\"count\":\(i),\"duration\":\(duration)}"
try! meta.write(to: out.appendingPathComponent("meta.json"), atomically: true, encoding: .utf8)
print(meta)
