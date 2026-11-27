#!/usr/bin/env swift

import AppKit
import Foundation

// MARK: - Configuration

struct IconSpec {
    let symbolName: String
    let assetName: String
    let baseSize: CGFloat
    let color: NSColor
    let weight: NSFont.Weight
}

func parseColor(_ hex: String) -> NSColor {
    var hex = hex.trimmingCharacters(in: .whitespacesAndNewlines)
    if hex.hasPrefix("#") { hex.removeFirst() }
    guard hex.count == 6, let value = UInt64(hex, radix: 16) else {
        return NSColor(red: 142/255, green: 142/255, blue: 147/255, alpha: 1.0)
    }
    return NSColor(
        red: CGFloat((value >> 16) & 0xFF) / 255,
        green: CGFloat((value >> 8) & 0xFF) / 255,
        blue: CGFloat(value & 0xFF) / 255,
        alpha: 1.0
    )
}

func parseWeight(_ name: String) -> NSFont.Weight {
    switch name.lowercased() {
    case "ultralight": return .ultraLight
    case "thin": return .thin
    case "light": return .light
    case "regular": return .regular
    case "medium": return .medium
    case "semibold": return .semibold
    case "bold": return .bold
    case "heavy": return .heavy
    case "black": return .black
    default: return .thin
    }
}

// MARK: - Generation

enum IconError: Error, CustomStringConvertible {
    case directoryCreation(String)
    case symbolNotFound(String)
    case configurationFailed(String)
    case pngCreation(String)
    case fileWrite(String)

    var description: String {
        switch self {
        case .directoryCreation(let msg): return msg
        case .symbolNotFound(let msg): return msg
        case .configurationFailed(let msg): return msg
        case .pngCreation(let msg): return msg
        case .fileWrite(let msg): return msg
        }
    }
}

func generateIcon(_ spec: IconSpec, outputDir: String) throws {
    let dir = "\(outputDir)/\(spec.assetName).imageset"
    do {
        try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
    } catch {
        throw IconError.directoryCreation("Could not create output directory '\(dir)': \(error.localizedDescription)")
    }

    let scales: [(suffix: String, multiplier: CGFloat)] = [("", 1), ("@2x", 2), ("@3x", 3)]

    for scale in scales {
        let pixelSize = spec.baseSize * scale.multiplier
        let imageSize = NSSize(width: pixelSize, height: pixelSize)

        let config = NSImage.SymbolConfiguration(
            pointSize: pixelSize * 0.40,
            weight: spec.weight,
            scale: .large
        )

        guard let symbol = NSImage(systemSymbolName: spec.symbolName, accessibilityDescription: nil) else {
            throw IconError.symbolNotFound("SF Symbol '\(spec.symbolName)' not found. Run 'SF Symbols' app to browse available names.")
        }

        guard let configured = symbol.withSymbolConfiguration(config) else {
            throw IconError.configurationFailed("Could not apply symbol configuration to '\(spec.symbolName)'")
        }

        let image = NSImage(size: imageSize, flipped: false) { rect in
            let symSize = configured.size
            let x = (rect.width - symSize.width) / 2
            let y = (rect.height - symSize.height) / 2
            let drawRect = NSRect(x: x, y: y, width: symSize.width, height: symSize.height)

            let tinted = NSImage(size: symSize, flipped: false) { tintRect in
                configured.draw(in: tintRect)
                spec.color.set()
                tintRect.fill(using: .sourceAtop)
                return true
            }

            tinted.draw(in: drawRect, from: .zero, operation: .sourceOver, fraction: 1.0)
            return true
        }

        guard let tiffData = image.tiffRepresentation,
              let bitmap = NSBitmapImageRep(data: tiffData),
              let pngData = bitmap.representation(using: .png, properties: [:]) else {
            throw IconError.pngCreation("Failed to create PNG for \(spec.assetName)\(scale.suffix)")
        }

        let fileName = "\(spec.assetName)\(scale.suffix).png"
        do {
            try pngData.write(to: URL(fileURLWithPath: "\(dir)/\(fileName)"))
        } catch {
            throw IconError.fileWrite("Failed to write \(fileName): \(error.localizedDescription)")
        }
        print("  \(fileName) (\(Int(pixelSize))x\(Int(pixelSize)))")
    }

    // Write Contents.json
    let json = """
    {
      "images" : [
        {
          "filename" : "\(spec.assetName).png",
          "idiom" : "universal",
          "scale" : "1x"
        },
        {
          "filename" : "\(spec.assetName)@2x.png",
          "idiom" : "universal",
          "scale" : "2x"
        },
        {
          "filename" : "\(spec.assetName)@3x.png",
          "idiom" : "universal",
          "scale" : "3x"
        }
      ],
      "info" : {
        "author" : "xcode",
        "version" : 1
      }
    }
    """
    do {
        try json.write(toFile: "\(dir)/Contents.json", atomically: true, encoding: .utf8)
    } catch {
        throw IconError.fileWrite("Failed to write Contents.json: \(error.localizedDescription)")
    }
}

func requireOptionValue(_ args: [String], at index: Int, flag: String) -> String {
    guard index < args.count else {
        fputs("ERROR: Missing value for \(flag)\n", stderr)
        exit(1)
    }
    let value = args[index]
    if value.hasPrefix("--") {
        fputs("ERROR: Missing value for \(flag)\n", stderr)
        exit(1)
    }
    return value
}

// MARK: - CLI

let args = CommandLine.arguments

if args.count < 3 || args.contains("--help") || args.contains("-h") {
    print("""
    Usage: generate_icons.swift <sf-symbol-name> <asset-name> [options]

    Options:
      --size <pt>       Base size in points (default: 68)
      --color <hex>     Color hex code (default: 8E8E93)
      --weight <name>   Font weight: ultralight|thin|light|regular|medium|semibold|bold|heavy|black (default: thin)
      --output <dir>    Output directory (default: /tmp/icons)

    Examples:
      generate_icons.swift doc.text.below.ecg editTool_expenseReport
      generate_icons.swift person.crop.rectangle editTool_businessCard --color 007AFF --weight regular
      generate_icons.swift receipt myReceipt --size 48 --output ./Assets.xcassets/icons

    Browse SF Symbol names: open the SF Symbols app (free from Apple) or https://developer.apple.com/sf-symbols/
    """)
    exit(0)
}

let symbolName = args[1]
let assetName = args[2]

var baseSize: CGFloat = 68
var colorHex = "8E8E93"
var weightName = "thin"
var outputDir = "/tmp/icons"

var i = 3
while i < args.count {
    switch args[i] {
    case "--size":
        let raw = requireOptionValue(args, at: i + 1, flag: "--size")
        guard let size = Double(raw), size > 0 else {
            fputs("ERROR: --size must be a positive number\n", stderr)
            exit(1)
        }
        baseSize = CGFloat(size)
        i += 2
        continue
    case "--color":
        colorHex = requireOptionValue(args, at: i + 1, flag: "--color")
        let stripped = colorHex.hasPrefix("#") ? String(colorHex.dropFirst()) : colorHex
        guard stripped.count == 6, UInt64(stripped, radix: 16) != nil else {
            fputs("ERROR: --color must be a 6-digit hex code (e.g. 007AFF)\n", stderr)
            exit(1)
        }
        i += 2
        continue
    case "--weight":
        weightName = requireOptionValue(args, at: i + 1, flag: "--weight")
        let validWeights = ["ultralight", "thin", "light", "regular", "medium", "semibold", "bold", "heavy", "black"]
        guard validWeights.contains(weightName.lowercased()) else {
            fputs("ERROR: --weight must be one of: \(validWeights.joined(separator: ", "))\n", stderr)
            exit(1)
        }
        i += 2
        continue
    case "--output":
        outputDir = requireOptionValue(args, at: i + 1, flag: "--output")
        i += 2
        continue
    default:
        fputs("WARNING: Unknown option \(args[i])\n", stderr)
    }
    i += 1
}

let spec = IconSpec(
    symbolName: symbolName,
    assetName: assetName,
    baseSize: baseSize,
    color: parseColor(colorHex),
    weight: parseWeight(weightName)
)

print("Generating \(assetName) from SF Symbol '\(symbolName)':")
do {
    try generateIcon(spec, outputDir: outputDir)
    print("Output: \(outputDir)/\(assetName).imageset/")
} catch {
    fputs("ERROR: \(error)\n", stderr)
    exit(1)
}
