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

test('skillsSystemText truncates a large body exactly at the per-skill cap', () => {
  // Documented boundary: `cap` (default 6000) limits each skill body separately;
  // the name and description headers are never truncated.
  const body = 'x'.repeat(7000) + 'NEVER-INCLUDED-TAIL';
  const t = skillsSystemText([{ name: 'big', description: 'big skill', body }], 6000);
  assert.ok(t.includes('# Skill: big'));
  assert.ok(t.includes('big skill'));
  assert.ok(t.includes('x'.repeat(6000)), 'body kept up to the cap');
  assert.ok(!t.includes('x'.repeat(6001)), 'nothing beyond the cap is kept');
  assert.ok(!t.includes('NEVER-INCLUDED-TAIL'), 'content past the cap is dropped');
  assert.equal(t, '# Skill: big\nbig skill\n\n' + 'x'.repeat(6000));
});

test('skillsSystemText keeps names and descriptions for seven realistic-size skills', () => {
  // Body and description lengths mirror the seven default skills as measured
  // (bodies ~3k-9k chars, descriptions ~100-500 chars): no skill name or
  // description is silently dropped, and per-skill bodies stay within the cap.
  const sizes = [
    { name: 'quantum-reasoning', descLen: 266, bodyLen: 7077 },
    { name: 'eq-layer', descLen: 324, bodyLen: 4272 },
    { name: 'polyglot-code-verification', descLen: 108, bodyLen: 3060 },
    { name: 'plan-auditor', descLen: 507, bodyLen: 8801 },
    { name: 'nomosguard', descLen: 210, bodyLen: 4289 },
    { name: 'literature-evidence-mcp', descLen: 332, bodyLen: 3836 },
    { name: 'scientific-computing-system', descLen: 375, bodyLen: 4187 },
  ];
  const fill = (text, len) => text.repeat(Math.ceil(len / text.length)).slice(0, len);
  const tail = (name) => `END-OF-${name.toUpperCase().replace(/[^A-Z]/g, '')}`;
  const skills = sizes.map(({ name, descLen, bodyLen }, i) => ({
    name,
    description: fill(`Use ${name} for its documented purpose in step ${i + 1}. `, descLen),
    body: fill(`Follow the protocol guidance for ${name}. `, bodyLen - tail(name).length) + tail(name),
  }));
  const t = skillsSystemText(skills); // default cap 6000
  for (const { name, description, body } of skills) {
    assert.ok(t.includes(`# Skill: ${name}`), `header kept for ${name}`);
    assert.ok(t.includes(description), `full description kept for ${name}`);
    if (body.length > 6000) {
      assert.ok(t.includes(body.slice(0, 6000)), `body capped at 6000 for ${name}`);
      assert.ok(!t.includes(tail(name)), `body beyond the cap dropped for ${name}`);
    } else {
      assert.ok(t.includes(body), `full body kept for ${name}`);
    }
  }
  // Upper sanity bound: 7 headers/descriptions plus at most 7 capped bodies.
  assert.ok(t.length <= 7 * (6000 + 1200));
});
