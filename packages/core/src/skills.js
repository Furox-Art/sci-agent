// GitHub'daki ajan becerilerini (SKILL.md) yükler ve sistem istemine ekler.
// Kaynak biçimi: "github:kullanici/depo[/alt/yol]"

export function parseSkillMd(text, source) {
  const m = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return null;
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([\w-]+):\s*(.+)$/);
    if (kv) meta[kv[1].toLowerCase()] = kv[2].trim();
  }
  const body = m[2].trim();
  if (!meta.name) return null;
  return { source, name: meta.name, description: meta.description ?? '', body };
}

export function githubSkillUrl(source) {
  const s = source.replace(/^github:/, '').replace(/\/+$/, '');
  const [owner, repo, ...rest] = s.split('/');
  if (!owner || !repo) throw new Error('github:kullanici/depo bekleniyor');
  const sub = rest.length ? rest.join('/') + '/' : '';
  return `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${sub}SKILL.md`;
}

export async function fetchSkill(source, fetchImpl = fetch) {
  if (!source.startsWith('github:')) throw new Error(`Geçersiz beceri kaynağı: ${source} ("github:kullanici/depo" bekleniyor)`);
  const res = await fetchImpl(githubSkillUrl(source), { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`SKILL.md alınamadı (${res.status}): ${githubSkillUrl(source)}`);
  const parsed = parseSkillMd(await res.text(), source);
  if (!parsed) throw new Error('SKILL.md biçimi çözümlenemedi (name alanı yok)');
  return parsed;
}

/** Yüklü becerileri sistem istemi metnine dönüştürür (bağlam koruması için gövde kırpılır). */
export function skillsSystemText(skills, cap = 6000) {
  if (!skills?.length) return '';
  return skills
    .map((s) => `# Beceri: ${s.name}${s.description ? `\n${s.description}` : ''}\n\n${String(s.body ?? '').slice(0, cap)}`)
    .join('\n\n');
}
