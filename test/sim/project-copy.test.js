import test from 'node:test';
import assert from 'node:assert/strict';
import { SCREENS } from '../../core/screens.js';
import { projectById } from '../../sim/projects.js';
import { connectionProgress } from '../../sim/project-progress.js';
import { projectReason } from '../../sim/ui/project-copy.js';
import { emptyBench } from '../../sim/bench.js';

test('every legacy project connection has a Chinese explanation in all screen and wand variants', () => {
  const projects = ['audio', 'toy'].flatMap(id => [projectById(id), projectById(id, { wand: true })]);
  for (const screen of SCREENS) projects.push(projectById('screen', { screenId: screen.id }), projectById('screen', { screenId: screen.id, wand: true }));
  for (const project of projects) {
    assert.ok(project);
    for (const link of project.links) {
      const chinese = projectReason('zh', link.why);
      assert.ok(chinese, `${project.id} ${link.a}: ${link.why}`);
      assert.match(chinese, /[\u3400-\u9fff]/);
      assert.equal(projectReason('en', link.why), link.why);
    }
  }
});

test('LED project wiring reasons are explained in Chinese', () => {
  const project = projectById('led-basics');
  assert.ok(project);
  for (const link of project.links) assert.match(projectReason('zh', link.why) ?? '', /[\u3400-\u9fff]/);
});

test('reason keys remain stable when wand links are inserted before screen links', () => {
  const plain = projectById('screen');
  const wand = projectById('screen', { wand: true });
  assert.ok(plain && wand);
  const a = connectionProgress(emptyBench(), plain).find(link => link.a === 'scr:SCK');
  const b = connectionProgress(emptyBench(), wand).find(link => link.a === 'scr:SCK');
  assert.ok(a && b);
  assert.equal(a.whyKey, b.whyKey);
});
