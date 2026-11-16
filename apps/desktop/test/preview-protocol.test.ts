import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createPreviewRegistry } from '../src/main/preview-protocol.js';

describe('preview-protocol', () => {
  const cleanupDirs: string[] = [];

  async function createTempDir(prefix: string): Promise<string> {
    const dir = await realpath(await mkdtemp(join(tmpdir(), prefix)));
    cleanupDirs.push(dir);
    return dir;
  }

  afterEach(async () => {
    await Promise.all(
      cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it('buildUrl generates inova-preview://view/<token>/<relativePosixPath> and reuses same token for canonical root', async () => {
    const rootDir = await createTempDir('inova-preview-test-');
    const registry = createPreviewRegistry();

    const url1 = await registry.buildUrl({
      rootDir,
      filePath: join(rootDir, 'index.html'),
    });
    expect(url1).toMatch(/^inova-preview:\/\/view\/[0-9a-f-]+\/index\.html$/);

    const token = await registry.authorizeRoot(rootDir);
    expect(url1).toBe(`inova-preview://view/${token}/index.html`);

    const url2 = await registry.buildUrl({
      rootDir,
      filePath: join(rootDir, 'assets', 'chart.js'),
    });
    expect(url2).toBe(`inova-preview://view/${token}/assets/chart.js`);

    await expect(
      registry.buildUrl({
        rootDir,
        filePath: join(rootDir, '..', 'outside.txt'),
      }),
    ).rejects.toThrow('fora do diretório raiz');
  });

  it('resolveRequest resolves relative assets inside root with exact mime types', async () => {
    const rootDir = await createTempDir('inova-preview-test-');
    await mkdir(join(rootDir, 'assets'), { recursive: true });

    await writeFile(join(rootDir, 'chart.js'), 'console.log("chart");', 'utf-8');
    await writeFile(join(rootDir, 'assets', 'logo.svg'), '<svg></svg>', 'utf-8');
    await writeFile(join(rootDir, 'index.html'), '<html></html>', 'utf-8');
    await writeFile(join(rootDir, 'document.pdf'), '%PDF-1.4', 'utf-8');
    await writeFile(join(rootDir, 'styles.css'), 'body { margin: 0; }', 'utf-8');

    const registry = createPreviewRegistry();

    const chartUrl = await registry.buildUrl({
      rootDir,
      filePath: join(rootDir, 'chart.js'),
    });
    const logoUrl = await registry.buildUrl({
      rootDir,
      filePath: join(rootDir, 'assets', 'logo.svg'),
    });
    const htmlUrl = await registry.buildUrl({
      rootDir,
      filePath: join(rootDir, 'index.html'),
    });
    const pdfUrl = await registry.buildUrl({
      rootDir,
      filePath: join(rootDir, 'document.pdf'),
    });
    const cssUrl = await registry.buildUrl({
      rootDir,
      filePath: join(rootDir, 'styles.css'),
    });

    const resolvedChart = await registry.resolveRequest(chartUrl);
    expect(resolvedChart).toEqual({
      filePath: join(rootDir, 'chart.js'),
      mimeType: 'text/javascript',
    });

    const resolvedLogo = await registry.resolveRequest(logoUrl);
    expect(resolvedLogo).toEqual({
      filePath: join(rootDir, 'assets', 'logo.svg'),
      mimeType: 'image/svg+xml',
    });

    const resolvedHtml = await registry.resolveRequest(htmlUrl);
    expect(resolvedHtml).toEqual({
      filePath: join(rootDir, 'index.html'),
      mimeType: 'text/html',
    });

    const resolvedPdf = await registry.resolveRequest(pdfUrl);
    expect(resolvedPdf).toEqual({
      filePath: join(rootDir, 'document.pdf'),
      mimeType: 'application/pdf',
    });

    const resolvedCss = await registry.resolveRequest(cssUrl);
    expect(resolvedCss).toEqual({
      filePath: join(rootDir, 'styles.css'),
      mimeType: 'text/css',
    });
  });

  it('resolveRequest returns null for unknown tokens, path traversal, escaping symlinks, or missing files', async () => {
    const rootDir = await createTempDir('inova-preview-root-');
    const outsideDir = await createTempDir('inova-preview-outside-');

    const outsideFile = join(outsideDir, 'secret.txt');
    await writeFile(outsideFile, 'secret content', 'utf-8');

    const insideFile = join(rootDir, 'normal.txt');
    await writeFile(insideFile, 'normal content', 'utf-8');

    const escapeSymlink = join(rootDir, 'escaped.txt');
    await symlink(outsideFile, escapeSymlink);

    const registry = createPreviewRegistry();
    const token = await registry.authorizeRoot(rootDir);

    expect(
      await registry.resolveRequest('inova-preview://view/unknown-token/normal.txt'),
    ).toBeNull();
    expect(
      await registry.resolveRequest(`inova-preview://view/${token}/../outside.txt`),
    ).toBeNull();
    expect(
      await registry.resolveRequest(`inova-preview://view/${token}/%2e%2e/outside.txt`),
    ).toBeNull();
    expect(await registry.resolveRequest(`inova-preview://view/${token}/escaped.txt`)).toBeNull();
    expect(await registry.resolveRequest(`inova-preview://view/${token}/not-found.txt`)).toBeNull();
    expect(await registry.resolveRequest(`inova-preview://view/${token}/`)).toBeNull();
    expect(await registry.resolveRequest('https://example.com/file.txt')).toBeNull();
    expect(
      await registry.resolveRequest(`inova-preview://other-host/${token}/normal.txt`),
    ).toBeNull();
  });
});
