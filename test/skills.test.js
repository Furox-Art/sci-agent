import { test } from 'node:test';
import assert from 'node:assert/strict';
import { githubSkillUrl, parseSkillMd, skillsSystemText } from '@sci/core';

test('githubSkillUrl doğru adres üretir', () => {
  assert.equal(githubSkillUrl('github:Furox-Art/quantum-reasoning-skill'), 'https://raw.githubusercontent.com/Furox-Art/quantum-reasoning-skill/HEAD/SKILL.md');
  assert.equal(githubSkillUrl('github:Furox-Art/eq-layer/skills/eq-layer'), 'https://raw.githubusercontent.com/Furox-Art/eq-layer/HEAD/skills/eq-layer/SKILL.md');
});

test('parseSkillMd frontmatter çözümler', () => {
  const md = '---\nname: quantum-reasoning\ndescription: Çoklu hipotez protokolü\n---\n\nGövde metni.';
  const s = parseSkillMd(md, 'github:x/y');
  assert.equal(s.name, 'quantum-reasoning');
  assert.equal(s.description, 'Çoklu hipotez protokolü');
  assert.equal(s.body, 'Gövde metni.');
  assert.equal(s.source, 'github:x/y');
});

test('parseSkillMd geçersiz girdide null döner', () => {
  assert.equal(parseSkillMd('frontmatter yok', 'github:x/y'), null);
  assert.equal(parseSkillMd('---\ndescription: isimsiz\n---\n\nx', 'github:x/y'), null);
});

test('skillsSystemText becerileri birleştirir ve kırpılır', () => {
  const skills = [
    { name: 'a', description: 'açıklama', body: 'gövde-a' },
    { name: 'b', description: '', body: 'x'.repeat(8000) },
  ];
  const t = skillsSystemText(skills, 6000);
  assert.match(t, /# Beceri: a/);
  assert.match(t, /gövde-a/);
  assert.ok(t.length < 12500);
});
