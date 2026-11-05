import { test } from 'node:test';
import assert from 'node:assert/strict';
import { githubSkillUrl, parseSkillMd, skillsSystemText } from '@sci/core';

test('githubSkillUrl builds the correct address', () => {
  assert.equal(githubSkillUrl('github:Furox-Art/quantum-reasoning-skill'), 'https://raw.githubusercontent.com/Furox-Art/quantum-reasoning-skill/HEAD/SKILL.md');
  assert.equal(githubSkillUrl('github:Furox-Art/eq-layer/skills/eq-layer'), 'https://raw.githubusercontent.com/Furox-Art/eq-layer/HEAD/skills/eq-layer/SKILL.md');
});

test('parseSkillMd parses frontmatter', () => {
  const md = '---\nname: quantum-reasoning\ndescription: multi-hypothesis protocol\n---\n\nBody text.';
  const s = parseSkillMd(md, 'github:x/y');
  assert.equal(s.name, 'quantum-reasoning');
  assert.equal(s.description, 'multi-hypothesis protocol');
  assert.equal(s.body, 'Body text.');
  assert.equal(s.source, 'github:x/y');
});

test('parseSkillMd returns null on invalid input', () => {
  assert.equal(parseSkillMd('no frontmatter', 'github:x/y'), null);
  assert.equal(parseSkillMd('---\ndescription: unnamed\n---\n\nx', 'github:x/y'), null);
});

test('skillsSystemText merges skills and caps them', () => {
  const skills = [
    { name: 'a', description: 'description', body: 'body-a' },
    { name: 'b', description: '', body: 'x'.repeat(8000) },
  ];
  const t = skillsSystemText(skills, 6000);
  assert.match(t, /# Skill: a/);
  assert.match(t, /body-a/);
  assert.ok(t.length < 12500);
});
