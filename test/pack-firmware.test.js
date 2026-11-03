import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pack } from '../tools/pack-firmware.js';

/** A firmware/build/ as idf.py leaves it: flasher_args.json shaped like the real one, and the images. */
function buildDir({ skip = '' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'fwbuild-'));
  mkdirSync(join(dir, 'bootloader'));
  mkdirSync(join(dir, 'partition_table'));
  const files = { '0x0': 'bootloader/bootloader.bin', '0x8000': 'partition_table/partition-table.bin', '0x10000': 'body.bin' };
  writeFileSync(join(dir, 'flasher_args.json'), JSON.stringify({
    flash_settings: { flash_mode: 'dio', flash_size: '2MB', flash_freq: '80m' },
    flash_files: files,
    extra_esptool_args: { chip: 'esp32s3' },
  }));
  for (const f of Object.values(files)) if (f !== skip) writeFileSync(join(dir, f), `image:${f}`);
  return dir;
}

test('pack writes a manifest with numeric offsets in order, and copies the images flat', () => {
  const out = mkdtempSync(join(tmpdir(), 'fwout-'));
  pack(buildDir(), out);
  const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
  assert.equal(manifest.chip, 'esp32s3');
  assert.equal(manifest.flashMode, 'dio');
  assert.equal(manifest.flashFreq, '80m');
  assert.deepEqual(manifest.files, [
    { offset: 0, path: 'bootloader.bin' },
    { offset: 0x8000, path: 'partition-table.bin' },
    { offset: 0x10000, path: 'body.bin' },
  ]);
  assert.equal(readFileSync(join(out, 'body.bin'), 'utf8'), 'image:body.bin');
});

test('pack names the missing image and writes nothing', () => {
  const out = mkdtempSync(join(tmpdir(), 'fwout-'));
  assert.throws(() => pack(buildDir({ skip: 'body.bin' }), out), /body\.bin/);
  assert.equal(existsSync(join(out, 'manifest.json')), false);
});
