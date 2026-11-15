// SEC-09 回归：数据文件原子写入不可被「预置同名临时文件」重定向（写穿）
// 旧实现用固定名 `<data>.tmp` + 默认 'w' 标志：目录内预置同名硬链接/符号链接时，
// writeFileSync 会跟随链接把 JSON 写到链接指向的任意文件。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeAtomic } from '../server.js';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'worklift-atomic-'));
}

function jsonFiles(dir) {
  return fs.readdirSync(dir).filter((n) => n.endsWith('.tmp'));
}

describe('数据文件原子写入：临时文件不可预测且不跟随链接', () => {
  test('预置同名 `<data>.tmp` 硬链接时，写入不会落到链接目标（写穿）', () => {
    const dir = tempDir();
    try {
      const dataFile = path.join(dir, 'worklift-data.json');
      const victim = path.join(dir, 'victim.txt');
      fs.writeFileSync(victim, 'ORIGINAL');

      // 模拟本地攻击者：提前把攻击目标硬链接到旧实现使用的固定临时名上
      let linked = true;
      try {
        fs.linkSync(victim, `${dataFile}.tmp`);
      } catch {
        linked = false; // 跨卷等环境不支持硬链接，退化为符号链接尝试
        try {
          fs.symlinkSync(victim, `${dataFile}.tmp`);
        } catch {
          linked = false;
        }
      }

      writeAtomic(dataFile, { ok: true, secret: 'should-not-leak' });

      assert.equal(fs.readFileSync(victim, 'utf8'), 'ORIGINAL', '链接目标文件不得被写入');
      const saved = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
      assert.deepEqual(saved, { ok: true, secret: 'should-not-leak' });
      if (linked) assert.ok(fs.existsSync(`${dataFile}.tmp`), '攻击者预置的链接本身不应被清理/覆盖');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('写入完成后不残留本次临时文件', () => {
    const dir = tempDir();
    try {
      const dataFile = path.join(dir, 'data.json');
      for (let i = 0; i < 5; i++) writeAtomic(dataFile, { i });
      assert.deepEqual(jsonFiles(dir), [], `不应残留临时文件：${jsonFiles(dir).join(', ')}`);
      assert.deepEqual(fs.readdirSync(dir).sort(), ['data.json'], '目录内应只有目标数据文件');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('并发写入互不干扰，最终文件始终是完整 JSON', async () => {
    const dir = tempDir();
    try {
      const dataFile = path.join(dir, 'data.json');
      await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          Promise.resolve().then(() => writeAtomic(dataFile, { writer: i, payload: 'x'.repeat(2048) })),
        ),
      );
      const saved = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
      assert.ok(Number.isInteger(saved.writer), '最终文件必须是某一次完整写入的结果');
      assert.equal(saved.payload.length, 2048, '内容不得被并发的另一次写入截断');
      assert.deepEqual(jsonFiles(dir), [], '并发写入不得残留临时文件');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('rename 失败时清理自己的临时文件并抛出，不污染目录', () => {
    const dir = tempDir();
    try {
      const blocked = path.join(dir, 'blocked.json');
      fs.mkdirSync(blocked); // 目标被同名目录占用 → rename 必然失败
      assert.throws(() => writeAtomic(blocked, { a: 1 }));
      assert.deepEqual(jsonFiles(dir), [], '失败路径也必须清理临时文件');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('数据文件权限为仅属主可读写（POSIX 0600）', { skip: process.platform === 'win32' }, () => {
    const dir = tempDir();
    try {
      const dataFile = path.join(dir, 'data.json');
      writeAtomic(dataFile, { a: 1 });
      const mode = fs.statSync(dataFile).mode & 0o777;
      assert.equal(mode.toString(8), '600', `实际权限 ${mode.toString(8)}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
