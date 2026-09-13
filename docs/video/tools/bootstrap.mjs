/**
 * Bootstraps the Sparticuz headless Chromium inside this Debian sandbox:
 * inflates the brotli payloads (binary, AL2023 shared libs, fonts, SwiftShader)
 * and wires LD_LIBRARY_PATH / FONTCONFIG_PATH so Playwright can drive it.
 */
import { inflate } from '/tmp/vidgen/node_modules/@sparticuz/chromium/build/lambdafs.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export async function bootstrap() {
  const bin = new URL('./node_modules/@sparticuz/chromium/bin/', import.meta.url).pathname;
  if (!existsSync(join(tmpdir(), 'chromium'))) {
    await inflate(join(bin, 'chromium.br'));
  }
  if (!existsSync(join(tmpdir(), 'fonts'))) await inflate(join(bin, 'fonts.tar.br'));
  if (!existsSync(join(tmpdir(), 'al2023'))) await inflate(join(bin, 'al2023.tar.br'));
  await inflate(join(bin, 'swiftshader.tar.br'));

  const libs = [join(tmpdir(), 'al2023', 'lib'), tmpdir()].join(':');
  process.env.LD_LIBRARY_PATH = libs;
  process.env.FONTCONFIG_PATH ??= join(tmpdir(), 'fonts');
  process.env.HOME ??= tmpdir();
  process.env.XDG_CACHE_HOME ??= join(tmpdir(), 'cache');
  return join(tmpdir(), 'chromium');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const p = await bootstrap();
  console.log('chromium:', p);
  console.log('fonts dir:', join(tmpdir(), 'fonts'));
  console.log('LD_LIBRARY_PATH:', process.env.LD_LIBRARY_PATH);
}
