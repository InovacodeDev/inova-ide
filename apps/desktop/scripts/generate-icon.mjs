import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = join(root, 'build');
const outIcns = join(buildDir, 'icon.icns');
const outPng = join(buildDir, 'icon.png');
const outIco = join(buildDir, 'icon.ico');
const workDir = mkdtempSync(join(tmpdir(), 'inova-icon-'));
const iconsetDir = join(workDir, 'icon.iconset');
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

function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);

  const dir = Buffer.alloc(entries.length * 16);
  let offset = header.length + dir.length;
  for (let i = 0; i < entries.length; i += 1) {
    const { size, data } = entries[i];
    const base = i * 16;
    dir.writeUInt8(size === 256 ? 0 : size, base);
    dir.writeUInt8(size === 256 ? 0 : size, base + 1);
    dir.writeUInt8(0, base + 2);
    dir.writeUInt8(0, base + 3);
    dir.writeUInt16LE(1, base + 4);
    dir.writeUInt16LE(32, base + 6);
    dir.writeUInt32LE(data.length, base + 8);
    dir.writeUInt32LE(offset, base + 12);
    offset += data.length;
  }
  return Buffer.concat([header, dir, ...entries.map((entry) => entry.data)]);
}

try {
  mkdirSync(buildDir, { recursive: true });
  mkdirSync(iconsetDir, { recursive: true });
  writeFileSync(swiftScript, swiftSource);
  execFileSync('swift', [swiftScript, outPng], { stdio: 'inherit' });

  const sizes = [16, 32, 128, 256, 512];
  for (const s of sizes) {
    execFileSync(
      'sips',
      ['-z', String(s), String(s), outPng, '--out', join(iconsetDir, `icon_${s}x${s}.png`)],
      { stdio: 'ignore' },
    );
    const s2 = s * 2;
    execFileSync(
      'sips',
      ['-z', String(s2), String(s2), outPng, '--out', join(iconsetDir, `icon_${s}x${s}@2x.png`)],
      { stdio: 'ignore' },
    );
  }
  execFileSync('iconutil', ['-c', 'icns', iconsetDir, '-o', outIcns], { stdio: 'inherit' });

  const icoSizes = [16, 32, 48, 64, 128, 256];
  const icoEntries = icoSizes.map((size) => {
    const file = join(workDir, `ico_${size}.png`);
    execFileSync('sips', ['-z', String(size), String(size), outPng, '--out', file], {
      stdio: 'ignore',
    });
    return { size, data: readFileSync(file) };
  });
  writeFileSync(outIco, buildIco(icoEntries));
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
