#!/usr/bin/env swift
//
// scripts/cutout-manny.swift
//
// Offline background removal for the Manny ink-and-pencil drawings on cream paper.
// Everything runs on this Mac. No network calls, no uploads, no third-party packages.
//
// How it works
//   1. macOS Vision subject lifting (VNGenerateForegroundInstanceMaskRequest, macOS 14+)
//      gives a soft subject mask. It already leaves out the ground shadow and the faint
//      construction lines, but it is computed at 512x512 and upscaled, so its edges carry
//      a 2-4 px fringe of cream paper.
//   2. A colour key on the cream paper refines that mask:
//      - the paper colour is measured locally (32 px grid) from pixels Vision calls background;
//      - paper-coloured pixels connected to the open paper (edge fringe, gaps between hair
//        strands) are found with a flood fill and made transparent;
//      - edge alpha is estimated from where each pixel sits between the local paper colour
//        and the local ink colour;
//      - dark ink that Vision clipped (stray hair strands) is grown back;
//      - outside Vision's mask, the colour alpha is capped by Vision, so shadow and
//        construction lines stay out.
//   3. Semi-transparent edge pixels are un-mixed from the paper colour (decontamination),
//      so there is no cream halo. Fully opaque pixels keep their original RGB values,
//      and compositing the cut-out back onto the paper colour reproduces the original.
//   If Vision finds no subject, the script falls back to the colour key alone
//   (flood fill of the paper from the image border).
//
// Usage
//   swift scripts/cutout-manny.swift <in.jpg> <out.png> [--preview <file.png>] [--vision-only]
//       Full-resolution transparent PNG. --preview writes the cut-out over teal and over white, plus
//       the original marked with what the colour key removed (red) or added (green) versus Vision. --vision-only skips the colour-key refinement.
//
//   swift scripts/cutout-manny.swift --meshy <outDir> [--group a.png,b.png,...] [--size 1024] [--margin 0.06] <cutout.png>...
//       Meshy-ready copies: subject centred on a transparent square canvas with the given margin.
//       Files named in --group (base names) are scaled so their subject heights match
//       exactly (turnaround views); other files are fitted individually.
//
//   swift scripts/cutout-manny.swift --stats <file.png>...
//       Prints size, alpha coverage and subject bounding box.
//
//   Add -O after `swift` (swift -O scripts/cutout-manny.swift ...) for a faster run.

import Foundation
import Vision
import CoreGraphics
import ImageIO
import CoreVideo
import UniformTypeIdentifiers

// MARK: - Helpers

func fail(_ msg: String) -> Never {
    FileHandle.standardError.write((msg + "\n").data(using: .utf8)!)
    exit(1)
}

let sRGB = CGColorSpace(name: CGColorSpace.sRGB)!

func loadCGImage(_ path: String) -> CGImage {
    guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
          let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else { fail("Cannot read \(path)") }
    return img
}

/// RGBA8, premultiplied. For an opaque JPEG this is the plain sRGB pixel values.
func rasterize(_ img: CGImage, width: Int? = nil, height: Int? = nil) -> [UInt8] {
    let w = width ?? img.width, h = height ?? img.height
    var px = [UInt8](repeating: 0, count: w * h * 4)
    px.withUnsafeMutableBytes { p in
        let ctx = CGContext(data: p.baseAddress, width: w, height: h, bitsPerComponent: 8,
                            bytesPerRow: w * 4, space: sRGB,
                            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        ctx.interpolationQuality = .high
        ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
    }
    return px
}

func makeImage(_ rgba: [UInt8], _ w: Int, _ h: Int, premultiplied: Bool) -> CGImage {
    let provider = CGDataProvider(data: Data(rgba) as CFData)!
    let info: CGImageAlphaInfo = premultiplied ? .premultipliedLast : .last
    return CGImage(width: w, height: h, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: w * 4,
                   space: sRGB, bitmapInfo: CGBitmapInfo(rawValue: info.rawValue),
                   provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)!
}

func writePNG(_ img: CGImage, _ path: String) {
    let url = URL(fileURLWithPath: path)
    try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    guard let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else {
        fail("Cannot write \(path)")
    }
    CGImageDestinationAddImage(dest, img, nil)
    if !CGImageDestinationFinalize(dest) { fail("Cannot write \(path)") }
}

@inline(__always) func clamp01(_ v: Float) -> Float { v < 0 ? 0 : (v > 1 ? 1 : v) }

/// Distance (chamfer 1 / sqrt2, two passes) from every pixel to the nearest `target` pixel.
/// With `frameIsTarget`, the area outside the image also counts as target (distance 1 from the edge pixels).
func distanceTo(_ target: [Bool], _ w: Int, _ h: Int, frameIsTarget: Bool = false) -> [Float] {
    let inf: Float = 1e9, d1: Float = 1, d2: Float = 1.41421356
    var d = target.map { $0 ? Float(0) : inf }
    if frameIsTarget {
        for x in 0..<w { d[x] = min(d[x], 1); d[(h - 1) * w + x] = min(d[(h - 1) * w + x], 1) }
        for y in 0..<h { d[y * w] = min(d[y * w], 1); d[y * w + w - 1] = min(d[y * w + w - 1], 1) }
    }
    for y in 0..<h {
        for x in 0..<w {
            let i = y * w + x
            var v = d[i]
            if v == 0 { continue }
            if x > 0 { v = min(v, d[i - 1] + d1) }
            if y > 0 {
                v = min(v, d[i - w] + d1)
                if x > 0 { v = min(v, d[i - w - 1] + d2) }
                if x < w - 1 { v = min(v, d[i - w + 1] + d2) }
            }
            d[i] = v
        }
    }
    for y in stride(from: h - 1, through: 0, by: -1) {
        for x in stride(from: w - 1, through: 0, by: -1) {
            let i = y * w + x
            var v = d[i]
            if v == 0 { continue }
            if x < w - 1 { v = min(v, d[i + 1] + d1) }
            if y < h - 1 {
                v = min(v, d[i + w] + d1)
                if x < w - 1 { v = min(v, d[i + w + 1] + d2) }
                if x > 0 { v = min(v, d[i + w - 1] + d2) }
            }
            d[i] = v
        }
    }
    return d
}

/// Box sum of radius r (window (2r+1)^2, clipped at the borders) via an integral image.
func boxSum(_ src: [Float], _ w: Int, _ h: Int, _ r: Int) -> [Float] {
    var integral = [Double](repeating: 0, count: (w + 1) * (h + 1))
    for y in 0..<h {
        var row: Double = 0
        for x in 0..<w {
            row += Double(src[y * w + x])
            integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1] + row
        }
    }
    var out = [Float](repeating: 0, count: w * h)
    for y in 0..<h {
        let y0 = max(0, y - r), y1 = min(h, y + r + 1)
        for x in 0..<w {
            let x0 = max(0, x - r), x1 = min(w, x + r + 1)
            let s = integral[y1 * (w + 1) + x1] - integral[y0 * (w + 1) + x1]
                - integral[y1 * (w + 1) + x0] + integral[y0 * (w + 1) + x0]
            out[y * w + x] = Float(s)
        }
    }
    return out
}

/// 4-connected flood fill from `seeds` through pixels where `passable` is true.
func flood(seeds: [Bool], passable: [Bool], _ w: Int, _ h: Int) -> [Bool] {
    var filled = [Bool](repeating: false, count: w * h)
    var queue = [Int32]()
    queue.reserveCapacity(w * h / 4)
    for i in 0..<(w * h) where seeds[i] && passable[i] { filled[i] = true; queue.append(Int32(i)) }
    var head = 0
    while head < queue.count {
        let i = Int(queue[head]); head += 1
        let x = i % w, y = i / w
        if x > 0, !filled[i - 1], passable[i - 1] { filled[i - 1] = true; queue.append(Int32(i - 1)) }
        if x < w - 1, !filled[i + 1], passable[i + 1] { filled[i + 1] = true; queue.append(Int32(i + 1)) }
        if y > 0, !filled[i - w], passable[i - w] { filled[i - w] = true; queue.append(Int32(i - w)) }
        if y < h - 1, !filled[i + w], passable[i + w] { filled[i + w] = true; queue.append(Int32(i + w)) }
    }
    return filled
}

/// 8-connected component labels of `on`. Returns labels (0 = off) and component sizes (index = label).
func components(_ on: [Bool], _ w: Int, _ h: Int) -> ([Int32], [Int]) {
    var label = [Int32](repeating: 0, count: w * h)
    var sizes = [0]
    var stack = [Int32]()
    for start in 0..<(w * h) where on[start] && label[start] == 0 {
        let id = Int32(sizes.count)
        var count = 0
        label[start] = id; stack.append(Int32(start))
        while let top = stack.popLast() {
            let i = Int(top); count += 1
            let x = i % w, y = i / w
            for dy in -1...1 {
                let yy = y + dy
                if yy < 0 || yy >= h { continue }
                for dx in -1...1 {
                    let xx = x + dx
                    if xx < 0 || xx >= w || (dx == 0 && dy == 0) { continue }
                    let j = yy * w + xx
                    if on[j] && label[j] == 0 { label[j] = id; stack.append(Int32(j)) }
                }
            }
        }
        sizes.append(count)
    }
    return (label, sizes)
}

func percentile(_ hist: [Int], binWidth: Float, _ p: Float) -> Float {
    let total = hist.reduce(0, +)
    if total == 0 { return 0 }
    let target = Int(Float(total) * p)
    var acc = 0
    for (b, c) in hist.enumerated() {
        acc += c
        if acc > target { return (Float(b) + 0.5) * binWidth }
    }
    return Float(hist.count) * binWidth
}

func median3(_ samples: [(Float, Float, Float)]) -> (Float, Float, Float) {
    func med(_ a: [Float]) -> Float { let s = a.sorted(); return s[s.count / 2] }
    return (med(samples.map { $0.0 }), med(samples.map { $0.1 }), med(samples.map { $0.2 }))
}

// MARK: - Vision

func visionMask(_ img: CGImage) -> (mask: [Float], instances: Int) {
    let w = img.width, h = img.height
    let empty = [Float](repeating: 0, count: w * h)
    let request = VNGenerateForegroundInstanceMaskRequest()
    let handler = VNImageRequestHandler(cgImage: img, options: [:])
    do { try handler.perform([request]) } catch {
        FileHandle.standardError.write("Vision failed: \(error)\n".data(using: .utf8)!)
        return (empty, 0)
    }
    guard let obs = request.results?.first, !obs.allInstances.isEmpty,
          let buf = try? obs.generateScaledMaskForImage(forInstances: obs.allInstances, from: handler) else {
        return (empty, 0)
    }
    CVPixelBufferLockBaseAddress(buf, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(buf, .readOnly) }
    guard CVPixelBufferGetWidth(buf) == w, CVPixelBufferGetHeight(buf) == h,
          CVPixelBufferGetPixelFormatType(buf) == kCVPixelFormatType_OneComponent32Float,
          let base = CVPixelBufferGetBaseAddress(buf) else {
        FileHandle.standardError.write("Unexpected Vision mask format\n".data(using: .utf8)!)
        return (empty, 0)
    }
    let bpr = CVPixelBufferGetBytesPerRow(buf)
    var mask = empty
    for y in 0..<h {
        let row = base.advanced(by: y * bpr).assumingMemoryBound(to: Float.self)
        for x in 0..<w { mask[y * w + x] = clamp01(row[x]) }
    }
    return (mask, obs.allInstances.count)
}

// MARK: - Cut-out

func cutout(inPath: String, outPath: String, previewPath: String?, visionOnly: Bool) {
    let cg = loadCGImage(inPath)
    let W = cg.width, H = cg.height, N = W * H
    let px = rasterize(cg)
    var R = [Float](repeating: 0, count: N), G = R, B = R
    for i in 0..<N { R[i] = Float(px[4 * i]); G[i] = Float(px[4 * i + 1]); B[i] = Float(px[4 * i + 2]) }
    let name = URL(fileURLWithPath: inPath).lastPathComponent

    var (V, instances) = visionMask(cg)
    var method = "vision"
    var visionCoverage = V.reduce(0, +) / Float(N)

    // --- Global paper colour: border band, Vision background only (or whole border if Vision failed).
    let band = max(8, min(W, H) / 25)
    var borderSamples = [(Float, Float, Float)]()
    for y in 0..<H {
        for x in 0..<W where x < band || x >= W - band || y < band || y >= H - band {
            let i = y * W + x
            if V[i] < 0.02 && (x + y) % 3 == 0 { borderSamples.append((R[i], G[i], B[i])) }
        }
    }
    if borderSamples.count < 500 { fail("\(name): not enough paper visible to measure the paper colour") }
    let paperGlobal = median3(borderSamples)

    // --- Vision failed or found almost nothing: colour-key fallback mask (flood the paper from the border).
    if instances == 0 || visionCoverage < 0.02 {
        method = "colour-key fallback (Vision found no subject)"
        var paperlike = [Bool](repeating: false, count: N)
        var seeds = [Bool](repeating: false, count: N)
        for i in 0..<N {
            let dr = R[i] - paperGlobal.0, dg = G[i] - paperGlobal.1, db = B[i] - paperGlobal.2
            paperlike[i] = (dr * dr + dg * dg + db * db).squareRoot() < 40
            let x = i % W, y = i / W
            seeds[i] = x == 0 || y == 0 || x == W - 1 || y == H - 1
        }
        let bg = flood(seeds: seeds, passable: paperlike, W, H)
        let (lab, sizes) = components(bg.map { !$0 }, W, H)
        let biggest = sizes.indices.dropFirst().max { sizes[$0] < sizes[$1] } ?? 0
        for i in 0..<N { V[i] = (lab[i] != 0 && sizes[Int(lab[i])] >= sizes[biggest] / 50) ? 1 : 0 }
        visionCoverage = V.reduce(0, +) / Float(N)
    }

    var alpha = V
    var log = [String]()
    log.append("vision instances \(instances), vision coverage \(String(format: "%.1f", visionCoverage * 100))%")

    if !visionOnly {
        if method == "vision" { method = "vision + paper colour-key refinement" }
        let inside = V.map { $0 >= 0.5 }
        let dOut = distanceTo(inside, W, H)                 // outside pixels: distance to subject
        let dIn = distanceTo(inside.map { !$0 }, W, H, frameIsTarget: true) // inside: distance to background or frame

        // --- Local paper colour field on a 32 px grid (median of confident background per cell).
        let cell = 32
        let gw = (W + cell - 1) / cell, gh = (H + cell - 1) / cell
        var cellSamples = [[(Float, Float, Float)]](repeating: [], count: gw * gh)
        for y in 0..<H {
            for x in 0..<W {
                let i = y * W + x
                if V[i] < 0.02 && dOut[i] > 6 {
                    let dr = R[i] - paperGlobal.0, dg = G[i] - paperGlobal.1, db = B[i] - paperGlobal.2
                    if (dr * dr + dg * dg + db * db) < 45 * 45 {
                        cellSamples[(y / cell) * gw + x / cell].append((R[i], G[i], B[i]))
                    }
                }
            }
        }
        var grid = [(Float, Float, Float)?](repeating: nil, count: gw * gh)
        for c in 0..<(gw * gh) where cellSamples[c].count >= 40 { grid[c] = median3(cellSamples[c]) }
        // Fill cells under the subject from their neighbours.
        var missing = grid.filter { $0 == nil }.count
        while missing > 0 {
            var next = grid
            for gy in 0..<gh {
                for gx in 0..<gw where grid[gy * gw + gx] == nil {
                    var s = (Float(0), Float(0), Float(0)); var n: Float = 0
                    for (dx, dy) in [(-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (1, 1), (-1, 1), (1, -1)] {
                        let xx = gx + dx, yy = gy + dy
                        if xx < 0 || yy < 0 || xx >= gw || yy >= gh { continue }
                        if let v = grid[yy * gw + xx] { s.0 += v.0; s.1 += v.1; s.2 += v.2; n += 1 }
                    }
                    if n > 0 { next[gy * gw + gx] = (s.0 / n, s.1 / n, s.2 / n) }
                }
            }
            let stillMissing = next.filter { $0 == nil }.count
            grid = next
            if stillMissing == missing { // no paper samples anywhere: use the global colour
                for c in 0..<(gw * gh) where grid[c] == nil { grid[c] = paperGlobal }
                break
            }
            missing = stillMissing
        }
        // Light 3x3 smoothing of the grid.
        var smooth = grid
        for gy in 0..<gh {
            for gx in 0..<gw {
                var s = (Float(0), Float(0), Float(0)); var n: Float = 0
                for dy in -1...1 {
                    for dx in -1...1 {
                        let xx = gx + dx, yy = gy + dy
                        if xx < 0 || yy < 0 || xx >= gw || yy >= gh { continue }
                        let v = grid[yy * gw + xx]!
                        s.0 += v.0; s.1 += v.1; s.2 += v.2; n += 1
                    }
                }
                smooth[gy * gw + gx] = (s.0 / n, s.1 / n, s.2 / n)
            }
        }
        var PR = [Float](repeating: 0, count: N), PG = PR, PB = PR
        for y in 0..<H {
            let fy = max(0, min(Float(gh - 1), (Float(y) + 0.5) / Float(cell) - 0.5))
            let y0 = Int(fy), y1 = min(gh - 1, y0 + 1), ty = fy - Float(y0)
            for x in 0..<W {
                let fx = max(0, min(Float(gw - 1), (Float(x) + 0.5) / Float(cell) - 0.5))
                let x0 = Int(fx), x1 = min(gw - 1, x0 + 1), tx = fx - Float(x0)
                let a = smooth[y0 * gw + x0]!, b = smooth[y0 * gw + x1]!, c = smooth[y1 * gw + x0]!, d = smooth[y1 * gw + x1]!
                let i = y * W + x
                PR[i] = (a.0 * (1 - tx) + b.0 * tx) * (1 - ty) + (c.0 * (1 - tx) + d.0 * tx) * ty
                PG[i] = (a.1 * (1 - tx) + b.1 * tx) * (1 - ty) + (c.1 * (1 - tx) + d.1 * tx) * ty
                PB[i] = (a.2 * (1 - tx) + b.2 * tx) * (1 - ty) + (c.2 * (1 - tx) + d.2 * tx) * ty
            }
        }

        // --- Distance of every pixel from the local paper colour; paper noise statistics.
        var dPaper = [Float](repeating: 0, count: N)
        var hist = [Int](repeating: 0, count: 400)
        for i in 0..<N {
            let dr = R[i] - PR[i], dg = G[i] - PG[i], db = B[i] - PB[i]
            dPaper[i] = (dr * dr + dg * dg + db * db).squareRoot()
            if V[i] < 0.02 && dOut[i] > 6 { hist[min(399, Int(dPaper[i] * 2))] += 1 }
        }
        let p50 = percentile(hist, binWidth: 0.5, 0.5), p90 = percentile(hist, binWidth: 0.5, 0.9)
        let p99 = percentile(hist, binWidth: 0.5, 0.99)
        let paperTol = max(12, 1.6 * p90)        // "looks like paper"
        let inkTol = max(50, 4 * p90)            // "clearly ink"
        log.append(String(format: "paper RGB %.0f %.0f %.0f, noise p50 %.1f p90 %.1f p99 %.1f, paper tol %.1f",
                          paperGlobal.0, paperGlobal.1, paperGlobal.2, p50, p90, p99, paperTol))

        // --- Local ink colour: average of clearly-ink pixels inside the mask (normalised box filter).
        var inkW = [Float](repeating: 0, count: N), inkR = inkW, inkG = inkW, inkB = inkW
        var globalInk = (Double(0), Double(0), Double(0), Double(0))
        for i in 0..<N where V[i] >= 0.9 && dPaper[i] > inkTol {
            inkW[i] = 1; inkR[i] = R[i]; inkG[i] = G[i]; inkB[i] = B[i]
            globalInk.0 += Double(R[i]); globalInk.1 += Double(G[i]); globalInk.2 += Double(B[i]); globalInk.3 += 1
        }
        let gInk = globalInk.3 > 0
            ? (Float(globalInk.0 / globalInk.3), Float(globalInk.1 / globalInk.3), Float(globalInk.2 / globalInk.3))
            : (Float(60), Float(45), Float(35))
        let sW = boxSum(inkW, W, H, 10), sR = boxSum(inkR, W, H, 10), sG = boxSum(inkG, W, H, 10), sB = boxSum(inkB, W, H, 10)
        let lW = boxSum(inkW, W, H, 36), lR = boxSum(inkR, W, H, 36), lG = boxSum(inkG, W, H, 36), lB = boxSum(inkB, W, H, 36)

        // --- Colour alpha: projection of (pixel - paper) onto (ink - paper), minus the paper noise floor.
        var colourAlpha = [Float](repeating: 0, count: N)
        var confidence = [Float](repeating: 0, count: N)
        var FR = [Float](repeating: 0, count: N), FG = FR, FB = FR
        for i in 0..<N {
            var fr: Float, fg: Float, fb: Float
            if sW[i] >= 4 { fr = sR[i] / sW[i]; fg = sG[i] / sW[i]; fb = sB[i] / sW[i] }
            else if lW[i] >= 4 { fr = lR[i] / lW[i]; fg = lG[i] / lW[i]; fb = lB[i] / lW[i] }
            else { fr = gInk.0; fg = gInk.1; fb = gInk.2 }
            FR[i] = fr; FG[i] = fg; FB[i] = fb
            let er = fr - PR[i], eg = fg - PG[i], eb = fb - PB[i]
            let ee = er * er + eg * eg + eb * eb
            let len = ee.squareRoot()
            let dr = R[i] - PR[i], dg = G[i] - PG[i], db = B[i] - PB[i]
            let a = ee > 1 ? clamp01((dr * er + dg * eg + db * eb) / ee) : 0
            let n0 = min(0.45, p90 / max(len, 1))
            colourAlpha[i] = clamp01((a - n0) / (0.9 - n0))
            confidence[i] = clamp01((len - 50) / 60)
        }

        // --- Paper flood: paper-coloured pixels connected to the open paper (or to the image frame where
        //     the subject is cut off by it), up to 6% of the image size into the mask.
        let maxDepth = Float(max(W, H)) * 0.06
        var paperlike = [Bool](repeating: false, count: N)
        var seeds = [Bool](repeating: false, count: N)
        for i in 0..<N {
            let x = i % W, y = i / W
            let onFrame = x == 0 || y == 0 || x == W - 1 || y == H - 1
            paperlike[i] = dPaper[i] < paperTol && dIn[i] <= maxDepth
            seeds[i] = (!inside[i] || onFrame) && dPaper[i] < paperTol
        }
        let paperFlood = flood(seeds: seeds, passable: paperlike, W, H)

        // Paper-coloured pockets fully enclosed by the drawing are kept on purpose: the artist uses bare
        // paper as highlights (sneaker rims, chalk lines, hair sheen), and by colour alone those cannot be
        // told apart from a sliver of paper between two limbs.

        // --- Dark-ink grow: very dark pixels (hair) connected to the mask, up to 40 px outside it.
        // Not in the bottom 8% of the figure, where the darkest strokes of the ground shadow touch the shoes.
        var maskBottom = 0, maskTop = H
        for i in 0..<N where inside[i] { maskBottom = max(maskBottom, i / W); maskTop = min(maskTop, i / W) }
        let noGrowBelow = maskBottom - Int(Float(maskBottom - maskTop) * 0.08)
        var darkInk = [Bool](repeating: false, count: N)
        for i in 0..<N {
            let lum = 0.2126 * R[i] + 0.7152 * G[i] + 0.0722 * B[i]
            darkInk[i] = !inside[i] && lum < 80 && dOut[i] <= 40 && i / W < noGrowBelow
        }
        var growSeeds = [Bool](repeating: false, count: N)
        for i in 0..<N where darkInk[i] && dOut[i] <= 1.5 { growSeeds[i] = true }
        let grown = flood(seeds: growSeeds, passable: darkInk, W, H)
        let grownNear = distanceTo(grown, W, H)

        // --- Edge ring: inside pixels within 2.5 px of the background or of flooded paper.
        var openPaper = [Bool](repeating: false, count: N)
        for i in 0..<N { openPaper[i] = !inside[i] || paperFlood[i] }
        let dEdge = distanceTo(openPaper, W, H)

        var nFloodIn = 0, nGrown = 0
        for i in 0..<N {
            let ca = colourAlpha[i], w = confidence[i]
            var a: Float
            if inside[i] {
                if paperFlood[i] {
                    a = w * ca; nFloodIn += 1
                } else if dEdge[i] <= 2.5 {
                    a = w * ca + (1 - w) * 1
                } else {
                    a = 1
                }
            } else {
                let cap = min(1, 2 * V[i])
                a = min(cap, w * ca + (1 - w) * V[i])
                if paperFlood[i] { a = min(a, w * ca) }
                if grown[i] || (grownNear[i] <= 1.5 && dPaper[i] >= paperTol) {
                    a = max(a, ca); if grown[i] { nGrown += 1 }
                }
            }
            alpha[i] = a
        }
        log.append("paper removed inside Vision mask: \(nFloodIn) px, dark ink added outside it: \(nGrown) px")

        // --- Drop specks that are not attached to the figure.
        let (lab, sizes) = components(alpha.map { $0 > 0.03 }, W, H)
        if sizes.count > 1 {
            let biggest = sizes.dropFirst().max() ?? 0
            let minKeep = max(300, biggest / 300)
            var dropped = 0
            for i in 0..<N where lab[i] != 0 && sizes[Int(lab[i])] < minKeep { alpha[i] = 0; dropped += 1 }
            log.append("specks removed: \(dropped) px in \(sizes.dropFirst().filter { $0 < minKeep }.count) islands")
        }
        for i in 0..<N where alpha[i] < 0.03 { alpha[i] = 0 }

        // --- Output: opaque pixels keep original RGB; edge pixels are un-mixed from the paper.
        var out = [UInt8](repeating: 0, count: N * 4)
        for i in 0..<N {
            let a = alpha[i]
            var r = R[i], g = G[i], b = B[i]
            if a <= 0 {
                r = 0; g = 0; b = 0
            } else if a < 0.999 {
                if a >= 0.15 {
                    r = (R[i] - (1 - a) * PR[i]) / a; g = (G[i] - (1 - a) * PG[i]) / a; b = (B[i] - (1 - a) * PB[i]) / a
                } else {
                    r = FR[i]; g = FG[i]; b = FB[i]
                }
            }
            out[4 * i] = UInt8(max(0, min(255, r.rounded())))
            out[4 * i + 1] = UInt8(max(0, min(255, g.rounded())))
            out[4 * i + 2] = UInt8(max(0, min(255, b.rounded())))
            out[4 * i + 3] = UInt8(max(0, min(255, (a * 255).rounded())))
        }
        finish(out: out, W: W, H: H, alpha: alpha, name: name, method: method, log: log, outPath: outPath,
               previewPath: previewPath, original: px, vision: V)
        return
    }

    var out = [UInt8](repeating: 0, count: N * 4)
    for i in 0..<N {
        let a = alpha[i]
        out[4 * i] = a > 0 ? px[4 * i] : 0
        out[4 * i + 1] = a > 0 ? px[4 * i + 1] : 0
        out[4 * i + 2] = a > 0 ? px[4 * i + 2] : 0
        out[4 * i + 3] = UInt8((a * 255).rounded())
    }
    finish(out: out, W: W, H: H, alpha: alpha, name: name, method: method, log: log, outPath: outPath,
           previewPath: previewPath, original: px, vision: V)
}

func finish(out: [UInt8], W: Int, H: Int, alpha: [Float], name: String, method: String, log: [String],
            outPath: String, previewPath: String?, original: [UInt8], vision: [Float]) {
    writePNG(makeImage(out, W, H, premultiplied: false), outPath)
    let N = W * H
    let mean = alpha.reduce(0, +) / Float(N) * 100
    let opaque = Float(alpha.filter { $0 >= 0.5 }.count) / Float(N) * 100
    print("\(name) -> \(outPath)")
    print("  method: \(method)")
    for l in log { print("  " + l) }
    print(String(format: "  size %dx%d, alpha coverage %.2f%% (mean alpha), %.2f%% of pixels >= 50%% opaque", W, H, mean, opaque))

    if let previewPath = previewPath {
        // Three panels: over teal (shows paper fringe), over white (shows dark fringe), and the original
        // with what the colour key changed versus Vision (red = removed, green = added).
        var pv = [UInt8](repeating: 255, count: 3 * W * H * 4)
        let backs: [(Float, Float, Float)] = [(20, 110, 140), (255, 255, 255)]
        for (k, bg) in backs.enumerated() {
            for y in 0..<H {
                for x in 0..<W {
                    let i = y * W + x, o = (y * 3 * W + k * W + x) * 4
                    let a = Float(out[4 * i + 3]) / 255
                    pv[o] = UInt8((Float(out[4 * i]) * a + bg.0 * (1 - a)).rounded())
                    pv[o + 1] = UInt8((Float(out[4 * i + 1]) * a + bg.1 * (1 - a)).rounded())
                    pv[o + 2] = UInt8((Float(out[4 * i + 2]) * a + bg.2 * (1 - a)).rounded())
                }
            }
        }
        for y in 0..<H {
            for x in 0..<W {
                let i = y * W + x, o = (y * 3 * W + 2 * W + x) * 4
                let removed = vision[i] >= 0.5 && alpha[i] < 0.5, added = vision[i] < 0.5 && alpha[i] >= 0.5
                pv[o] = removed ? 255 : (added ? 0 : original[4 * i])
                pv[o + 1] = removed ? 0 : (added ? 200 : original[4 * i + 1])
                pv[o + 2] = removed ? 0 : (added ? 0 : original[4 * i + 2])
            }
        }
        writePNG(makeImage(pv, 3 * W, H, premultiplied: true), previewPath)
    }
}

// MARK: - Stats

struct AlphaInfo { let w: Int; let h: Int; let mean: Double; let opaque: Double; let bbox: (Int, Int, Int, Int) }

/// bbox = (minX, minY, maxX, maxY) of rows/columns holding at least 2 pixels with alpha >= 32.
func alphaInfo(_ img: CGImage) -> AlphaInfo {
    let w = img.width, h = img.height
    let px = rasterize(img)
    var sum = 0.0, opaque = 0
    var rows = [Int](repeating: 0, count: h), cols = [Int](repeating: 0, count: w)
    for y in 0..<h {
        for x in 0..<w {
            let a = px[(y * w + x) * 4 + 3]
            sum += Double(a)
            if a >= 128 { opaque += 1 }
            if a >= 32 { rows[y] += 1; cols[x] += 1 }
        }
    }
    let minY = rows.firstIndex { $0 >= 2 } ?? 0, maxY = rows.lastIndex { $0 >= 2 } ?? (h - 1)
    let minX = cols.firstIndex { $0 >= 2 } ?? 0, maxX = cols.lastIndex { $0 >= 2 } ?? (w - 1)
    return AlphaInfo(w: w, h: h, mean: sum / 255 / Double(w * h) * 100, opaque: Double(opaque) / Double(w * h) * 100,
                     bbox: (minX, minY, maxX, maxY))
}

func stats(_ paths: [String]) {
    for p in paths {
        let info = alphaInfo(loadCGImage(p))
        let b = info.bbox
        print(String(format: "%@  %dx%d  alpha coverage %.2f%% (mean)  %.2f%% >=50%%  subject bbox x%d-%d y%d-%d (%dx%d)",
                     URL(fileURLWithPath: p).lastPathComponent, info.w, info.h, info.mean, info.opaque,
                     b.0, b.2, b.1, b.3, b.2 - b.0 + 1, b.3 - b.1 + 1))
    }
}

// MARK: - Meshy

func meshy(outDir: String, files: [String], group: Set<String>, size: Int, margin: Double) {
    let usable = Double(size) * (1 - 2 * margin)
    struct Item { let path: String; let img: CGImage; let info: AlphaInfo }
    let items = files.map { p -> Item in let img = loadCGImage(p); return Item(path: p, img: img, info: alphaInfo(img)) }
    func base(_ p: String) -> String { URL(fileURLWithPath: p).deletingPathExtension().lastPathComponent }
    func dims(_ it: Item) -> (Double, Double) {
        (Double(it.info.bbox.2 - it.info.bbox.0 + 1), Double(it.info.bbox.3 - it.info.bbox.1 + 1))
    }

    // Turnaround group: one common subject height, small enough that every member also fits in width.
    let members = items.filter { group.contains(base($0.path)) }
    var groupHeight = usable
    for it in members {
        let (bw, bh) = dims(it)
        groupHeight = min(groupHeight, usable * bh / bw)
    }
    if !members.isEmpty {
        let hs = members.map { dims($0).1 }
        print(String(format: "turnaround group: %d views, source subject heights %@ px (spread %.1f%%), canvas height %.0f px",
                     members.count, hs.map { String(Int($0)) }.joined(separator: "/"),
                     (hs.max()! - hs.min()!) / hs.max()! * 100, groupHeight))
    }

    for it in items {
        let (bw, bh) = dims(it)
        let scale = group.contains(base(it.path)) ? groupHeight / bh : min(usable / bw, usable / bh)
        let dw = Double(it.info.w) * scale, dh = Double(it.info.h) * scale
        // Centre the subject's bounding box on the canvas.
        let cx = (Double(it.info.bbox.0) + bw / 2) * scale
        let cyTop = (Double(it.info.bbox.1) + bh / 2) * scale
        let originX = Double(size) / 2 - cx
        let originYTop = Double(size) / 2 - cyTop
        var px = [UInt8](repeating: 0, count: size * size * 4)
        px.withUnsafeMutableBytes { p in
            let ctx = CGContext(data: p.baseAddress, width: size, height: size, bitsPerComponent: 8, bytesPerRow: size * 4,
                                space: sRGB, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
            ctx.interpolationQuality = .high
            // CG origin is bottom-left; convert the top-down offset.
            ctx.draw(it.img, in: CGRect(x: originX, y: Double(size) - originYTop - dh, width: dw, height: dh))
        }
        let out = URL(fileURLWithPath: outDir).appendingPathComponent(base(it.path) + ".png").path
        writePNG(makeImage(px, size, size, premultiplied: true), out)
        let info = alphaInfo(loadCGImage(out))
        let b = info.bbox
        print(String(format: "%@ -> %@  scale %.4f  subject %dx%d at x%d-%d y%d-%d  alpha coverage %.2f%%%@",
                     base(it.path), out, scale, b.2 - b.0 + 1, b.3 - b.1 + 1, b.0, b.2, b.1, b.3, info.mean,
                     group.contains(base(it.path)) ? "  [turnaround]" : ""))
    }
}

// MARK: - Main

var args = Array(CommandLine.arguments.dropFirst())
func usage() -> Never {
    fail("""
    usage:
      swift scripts/cutout-manny.swift <in.jpg> <out.png> [--preview <file.png>] [--vision-only]
      swift scripts/cutout-manny.swift --meshy <outDir> [--group a,b,...] [--size 1024] [--margin 0.06] <cutout.png>...
      swift scripts/cutout-manny.swift --stats <file.png>...
    """)
}
if args.isEmpty { usage() }

if args[0] == "--stats" {
    stats(Array(args.dropFirst()))
} else if args[0] == "--meshy" {
    guard args.count >= 3 else { usage() }
    let outDir = args[1]
    var rest = Array(args.dropFirst(2))
    var group = Set<String>(), size = 1024, margin = 0.06
    var files = [String]()
    while !rest.isEmpty {
        let a = rest.removeFirst()
        switch a {
        case "--group":
            guard !rest.isEmpty else { usage() }
            group = Set(rest.removeFirst().split(separator: ",").map {
                URL(fileURLWithPath: String($0)).deletingPathExtension().lastPathComponent })
        case "--size": guard let v = rest.first.flatMap({ Int($0) }) else { usage() }; size = v; rest.removeFirst()
        case "--margin": guard let v = rest.first.flatMap({ Double($0) }) else { usage() }; margin = v; rest.removeFirst()
        default: files.append(a)
        }
    }
    meshy(outDir: outDir, files: files, group: group, size: size, margin: margin)
} else {
    guard args.count >= 2 else { usage() }
    let inPath = args[0], outPath = args[1]
    var preview: String? = nil, visionOnly = false
    var rest = Array(args.dropFirst(2))
    while !rest.isEmpty {
        let a = rest.removeFirst()
        switch a {
        case "--preview": guard !rest.isEmpty else { usage() }; preview = rest.removeFirst()
        case "--vision-only": visionOnly = true
        default: usage()
        }
    }
    cutout(inPath: inPath, outPath: outPath, previewPath: preview, visionOnly: visionOnly)
}
