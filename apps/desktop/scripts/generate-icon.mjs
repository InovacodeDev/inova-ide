import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outIcns = join(root, 'build', 'icon.icns');
const workDir = mkdtempSync(join(tmpdir(), 'inova-icon-'));
const iconsetDir = join(workDir, 'icon.iconset');
const masterPng = join(workDir, 'icon_1024.png');
const swiftScript = join(workDir, 'render.swift');

const swiftSource = `
import AppKit
import Foundation

let outPath = CommandLine.arguments[1]
let size = 1024
let rep = NSBitmapImageRep(
  bitmapDataPlanes: nil,
  pixelsWide: size,
  pixelsHigh: size,
  bitsPerSample: 8,
  samplesPerPixel: 4,
  hasAlpha: true,
  isPlanar: false,
  colorSpaceName: .deviceRGB,
  bytesPerRow: 0,
  bitsPerPixel: 0
)!

NSGraphicsContext.saveGraphicsState()
let ctx = NSGraphicsContext(bitmapImageRep: rep)!
NSGraphicsContext.current = ctx
let cg = ctx.cgContext

let inset: CGFloat = 64
let rect = CGRect(x: inset, y: inset, width: CGFloat(size) - inset * 2, height: CGFloat(size) - inset * 2)
let radius: CGFloat = 200
let bgPath = CGPath(roundedRect: rect, cornerWidth: radius, cornerHeight: radius, transform: nil)

cg.setFillColor(CGColor(red: 0x14 / 255.0, green: 0x15 / 255.0, blue: 0x18 / 255.0, alpha: 1.0))
cg.addPath(bgPath)
cg.fillPath()

cg.setStrokeColor(CGColor(red: 0x2c / 255.0, green: 0x2e / 255.0, blue: 0x33 / 255.0, alpha: 1.0))
cg.setLineWidth(12)
cg.addPath(bgPath)
cg.strokePath()

let scale: CGFloat = 26.0
let offsetX: CGFloat = (CGFloat(size) - 24.0 * scale) / 2.0
let offsetY: CGFloat = (CGFloat(size) - 24.0 * scale) / 2.0

func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
  CGPoint(x: offsetX + x * scale, y: CGFloat(size) - (offsetY + y * scale))
}

cg.setStrokeColor(CGColor(red: 1.0, green: 0x5a / 255.0, blue: 0x1f / 255.0, alpha: 1.0))
cg.setLineWidth(2.2 * scale)
cg.setLineCap(.round)
cg.setLineJoin(.round)

cg.move(to: pt(3.5, 7))
cg.addLine(to: pt(8.5, 12))
cg.addLine(to: pt(3.5, 17))
cg.strokePath()

cg.move(to: pt(11.5, 12))
cg.addLine(to: pt(14.5, 12))
cg.strokePath()

cg.move(to: pt(14.5, 12))
cg.addLine(to: pt(19.0, 6.5))
cg.strokePath()

cg.move(to: pt(14.5, 12))
cg.addLine(to: pt(20.0, 12))
cg.strokePath()

cg.move(to: pt(14.5, 12))
cg.addLine(to: pt(19.0, 17.5))
cg.strokePath()

NSGraphicsContext.restoreGraphicsState()

let pngData = rep.representation(using: .png, properties: [:])!
try pngData.write(to: URL(fileURLWithPath: outPath))
`;

try {
  mkdirSync(dirname(outIcns), { recursive: true });
  mkdirSync(iconsetDir, { recursive: true });
  writeFileSync(swiftScript, swiftSource);
  execFileSync('swift', [swiftScript, masterPng], { stdio: 'inherit' });

  const sizes = [16, 32, 128, 256, 512];
  for (const s of sizes) {
    execFileSync(
      'sips',
      ['-z', String(s), String(s), masterPng, '--out', join(iconsetDir, `icon_${s}x${s}.png`)],
      { stdio: 'ignore' },
    );
    const s2 = s * 2;
    execFileSync(
      'sips',
      ['-z', String(s2), String(s2), masterPng, '--out', join(iconsetDir, `icon_${s}x${s}@2x.png`)],
      { stdio: 'ignore' },
    );
  }
  execFileSync('iconutil', ['-c', 'icns', iconsetDir, '-o', outIcns], { stdio: 'inherit' });
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
