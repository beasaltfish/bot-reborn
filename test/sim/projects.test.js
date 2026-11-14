import test from 'node:test';
import assert from 'node:assert/strict';
import { PROJECTS, projectById } from '../../sim/projects.js';
import { RECIPES, recipeSteps } from '../../sim/recipes.js';

test('legacy recipes expose ordered project links without changing their wire steps', () => {
  assert.deepEqual(PROJECTS.slice(0, 3).map(p => p.id), ['audio', 'screen', 'toy']);
  for (const recipe of RECIPES) {
    const project = projectById(recipe.id);
    assert.ok(project);
    const wireSteps = recipeSteps(recipe.id).filter(s => s.kind === 'wire');
    assert.deepEqual(project.links.map(l => [l.a, l.b]), wireSteps.map(s => s.named));
    assert.ok(project.links.every(l => l.why.length > 0));
    assert.deepEqual(project.steps, recipeSteps(recipe.id));
    assert.equal(projectById(project.id), project);
  }
  assert.equal(projectById('missing'), null);
});

test('project adapter uses the chosen screen and optional wand', () => {
  const project = projectById('screen', { screenId: 'st7735-160', wand: true });
  assert.ok(project);
  assert.deepEqual(project.steps, recipeSteps('screen', 'st7735-160', true));
  assert.ok(project.links.some(link => link.a.startsWith('imu:')));
  assert.ok(project.links.some(link => link.a.startsWith('scr:')));
});
