const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { unzipSync } = require('fflate');

const version = process.env.KDOCS_CLI_VERSION || '2.5.29';
const arch = process.env.KDOCS_CLI_ARCH || 'amd64';
const archiveName = `kdocs-cli-${version}-windows-${arch}.zip`;
const baseUrl = process.env.KDOCS_CLI_CDN || 'https://wpsai.wpscdn.cn/skillhub/pro';
const archiveUrl = `${baseUrl}/v${version}/releases/${archiveName}`;
const checksumsUrl = `${baseUrl}/v${version}/releases/checksums.txt`;
const projectRoot = path.resolve(__dirname, '..');
const outputDir = path.join(projectRoot, 'vendor', 'kdocs-cli');
const outputPath = path.join(outputDir, 'kdocs-cli.exe');

async function download(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`下载失败 ${response.status}: ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

function expectedSha256(checksums) {
  const line = checksums.split(/\r?\n/).find(item => item.trim().endsWith(`  ${archiveName}`));
  if (!line) throw new Error(`官方校验文件中没有找到 ${archiveName}`);
  return line.trim().split(/\s+/)[0].toLowerCase();
}

async function main() {
  if (fs.existsSync(outputPath) && !process.env.FORCE_KDOCS_CLI_DOWNLOAD) {
    console.log(`kdocs-cli ${version} 已存在：${outputPath}`);
    return;
  }

  console.log(`下载官方 kdocs-cli ${version}（Windows ${arch}）…`);
  const [archive, checksumsBuffer] = await Promise.all([download(archiveUrl), download(checksumsUrl)]);
  const expected = expectedSha256(checksumsBuffer.toString('utf8'));
  const actual = crypto.createHash('sha256').update(archive).digest('hex');
  if (actual !== expected) throw new Error(`kdocs-cli 校验失败：期望 ${expected}，实际 ${actual}`);

  const files = unzipSync(new Uint8Array(archive));
  const entryName = Object.keys(files).find(name => name === 'kdocs-cli.exe' || name.endsWith('/kdocs-cli.exe'));
  if (!entryName) throw new Error('官方压缩包中没有找到 kdocs-cli.exe');

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputPath, Buffer.from(files[entryName]));
  fs.writeFileSync(path.join(outputDir, 'VERSION'), `${version}\n`, 'utf8');
  console.log(`已准备 kdocs-cli：${outputPath}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
