<div align="center">
  <img src="docs/assets/logo.png" alt="SciAgent — bilimsel kodlama ajanı" width="560" />
</div>

Model-bağımsız, Claude benzeri bütünleşik bir kodlama ajanı: **çekirdek motor + CLI**. Özel bilimsel modelinizi OpenAI uyumlu bir API üzerinden bağlarsınız; ajan dosya okuma/yazma, arama ve terminal komutlarını **onay mekanizmasıyla** çalıştırır.

[![tests](https://github.com/Furox-Art/sci-agent/actions/workflows/test.yml/badge.svg)](https://github.com/Furox-Art/sci-agent/actions/workflows/test.yml)

## Mimari

```
sci-agent/
├─ packages/
│  ├─ core/      # Ajan motoru: sağlayıcı arayüzü, araç sistemi, onay politikası, döngü
│  └─ cli/       # Terminal arayüzü (sci-agent komutu)
└─ test/         # node:test ile otomatik testler
```

- **Model-bağımsız:** Herhangi bir OpenAI uyumlu uç nokta (vLLM, Ollama, HF TGI, LM Studio, bulut API'leri…).
- **Ajan döngüsü:** Model → araç çağrısı → sonuç → model … (adım sınırıyla).
- **Paralel alt-ajanlar:** Model aynı adımda birden çok `task` çağrısı verirse alt ajanlar **eşzamanlı** yürütülür; her alt ajan kendi bağlamında çalışır, özetini ana ajana döndürür. Alt ajanlar iç içe `task` başlatamaz.
- **Eklenti sistemi:** `packages/core/src/plugins.js` içindeki kancayla araç takımları ve sistem istemi eklemeleri yapılandırma değiştirmeden yüklenir (bkz. "Bilimsel model geldiğinde").
- **Akışlı yanıtlar:** `model.stream` (varsayılan `true`) ile metin ve akıl yürütme deltaları canlı gösterilir; sunucu akışı reddederse bir kez akışsız denenir.
- **Onay politikası:** `read_file`, `list_dir`, `search_files`, `csv_stats` otomatik; `write_file`, `edit_file`, `run_command`, `python_eval` varsayılan olarak **onay ister** (politika `sci-agent.config.json` ile değiştirilebilir).
- **Çalışma alanı sanal kutusu:** Araçlar yapılandırılan kökün dışına erişemez.

## Kurulum

```bash
npm install
```

## Model bağlama

1. `sci-agent.config.example.json` dosyasını `sci-agent.config.json` olarak kopyalayın ve düzenleyin (bu dosya git'e girmez).
2. Ya da ortam değişkenleri: `SCI_AGENT_BASE_URL`, `SCI_AGENT_API_KEY`, `SCI_AGENT_MODEL`, `SCI_AGENT_PROVIDER`.

Örnek — Ollama:

```bash
SCI_AGENT_BASE_URL=http://localhost:11434/v1 SCI_AGENT_MODEL=komut-satiri-modeli npm run cli
```

Örnek — vLLM üzerinde barındırılan bilimsel model:

```bash
SCI_AGENT_BASE_URL=http://sunucu:8000/v1 SCI_AGENT_API_KEY=... SCI_AGENT_MODEL=bilimsel-model npm run cli
```

Henüz model yoksa `SCI_AGENT_PROVIDER=mock` ile betikli sahte model kullanılabilir (CLI’ı denemek için).

## Kullanım

```bash
npm run cli        # terminal ajanı (sci-agent)
npm test           # otomatik testler
```

### WSL'den çalıştırma

```bash
gh repo clone Furox-Art/sci-agent ~/sci-agent
cd ~/sci-agent && npm ci
SCI_AGENT_PROVIDER=mock npm run cli
```

### CLI

```bash
npm run cli                                        # etkileşimli terminal
node packages/cli/bin/sci-agent.js --prompt "görev" # tek seferlik görev
node packages/cli/bin/sci-agent.js --workspace <dizin>
```

| Komut | İş |
|---|---|
| `/help` | komut listesi |
| `/model` | model/yapılandırma bilgisi |
| `/tools` | araç listesi (ajan araçları turkuaz işaretli) |
| `/tools <filtre>` | ad/açıklamada arama: boşluk = VE, `\|` = VEYA |
| `/sessions` | oturum listesi |
| `/sessions <no>` | oturuma geç |
| `/sessions del <no>` | oturumu sil |
| `/sessions ren <no> <başlık>` | yeniden adlandır |
| `/save` | sohbeti zaman damgalı `sciagent-sohbet-*.md` olarak kaydet |
| `/test` | model bağlantısını test et |
| `/clear` | sohbeti temizle (dosya kaydı da sıfırlanır) |
| `/exit` | çıkış |

CLI oturumları `.sci-agent-sessions/` dizininde saklar; mevcut oturum dosyaları kullanılmaya devam eder. Akışlı yanıtlar, alt-ajan olayları (`▶ ■ ↳`) ve eq-layer yönlendirmesi terminalde de aktiftir; onay isteyen araçlar terminalde `e/h` sorar.

### Örnek veriler

CLI üzerinden `csv_stats` ve diğer bilimsel araçlarla denemek için `examples/` altında üç hazır CSV var:

| Dosya | İçerik | Beklenen eğri |
|---|---|---|
| `examples/veri.csv` | 3 aylık sıcaklık/nem/basınç serisi | Çok serili çizgi |
| `examples/kinetics.csv` | Birinci mertebe tepkime: konsantrasyon + ln[C] (k = 0.035/dk) | Üstel bozunum + ln'de düz çizgi |
| `examples/titration.csv` | Zayıf asit titrasyonu (0.010 M asetik asit, eşdeğerlik 12.5 mL) | Eşdeğerlikte dik sıçramalı S eğrisi |

## Araçlar

| Araç | Onay | Açıklama |
|---|---|---|
| `read_file` | hayır | Metin dosyası okur |
| `list_dir` | hayır | Dizin listeler |
| `search_files` | hayır | Ad/ içerik araması (regex) |
| `write_file` | evet | Dosya yazar/üzerine yazar |
| `edit_file` | evet | Bul-değiştir ile dosya düzenler (çoklu eşleşme koruması) |
| `run_command` | evet | Kabuk komutu çalıştırır |
| `task` | hayır* | Alt ajan başlatır; aynı adımdakiler paralel yürür (*alt ajanın tehlikeli çağrıları yine onay ister) |
| `python_eval` | evet | Python kodu çalıştırır (PATH'ten bağımsız Python çözücü: `pybridge`) |
| `csv_stats` | hayır | CSV sütunları için n/ortalama/ss/min/maks |
| `math_eval` | hayır | Güvenli matematik ifade değerlendirici (parser'lı, eval'siz) |
| `unit_convert` | hayır | Birim dönüşümleri (uzunluk, kütle, enerji, basınç, sıcaklık, açı…) |
| `physical_constants` | hayır | 22 fizik sabiti (CODATA, birimli) |
| `stats_calc` | hayır | Betimsel istatistik, Pearson korelasyonu, doğrusal regresyon |
| `matrix_ops` | hayır | Matris determinant, ters ve çarpım (Gauss eliminasyonu) |
| `molar_mass` | hayır | Formülden mol kütlesi — 118 element (IUPAC kütleleri, hidrat destekli) |
| `furox_compute` | evet | Kullanıcının bilimsel yığınıyla (numpy/scipy/pandas/cds2/axiomize) Python kodu |
| `axiomize_cli` | evet | axiomize CLI: modelleme IR, birim/boyut doğrulama, belirsizlik, SBML/CellML/Modelica |
| `cds2_cli` | evet | cds2 CLI (scientific-computing-system-2.0): lineer cebir, ODE/PDE, Monte Carlo, sinyal, kuantum sim. |
| `lit_search` | hayır | Literatür araması: OpenAlex + Europe PMC + Crossref eşzamanlı |
| `lit_verify` | hayır | Atıf eşleşme + retraksiyon/düzeltme kontrolü (DOI/başlık) |
| `lit_quote` | hayır | Tam metin alıntı eşleşmesi (PMCID + sha256 kanıtlı) |
| `lit_audit` | hayır | Metodoloji denetimi: Europe PMC JATS tam metninde raporlama eklerinin paragraf eşleşmesi (alıntı izlenebilirliği) |
| `lit_screen` | hayır | PRISMA tarzı otomatik ön eleme: anahtar kelime + dahil etme ölçütleriyle include/exclude (tek geçiş, geçici karar) |
| `lit_ledger` | hayır | Hash-zincirli kanıt defteri (JSONL) bütünlük doğrulaması (yerel, ağsız) |
| `lit_fulltext` | hayır | OA tam metin okuma (Europe PMC): `read_fulltext(pmcid, max_chars)` |
| `lit_cite_graph` | hayır | OpenAlex atıf grafiği: `expand_citation_chain` ile ileri/geri zincirleme |
| `lit_data_code` | hayır | Crossref veri/yazılım bağlantıları: makalenin veri ve kod erişilebilirliği |
| `lit_bib` | hayır | Kaynakça dışa aktarma: BibTeX / RIS / CSL-JSON (çevrimdışı) |
| `lit_quote_text` | hayır | Verilen metinde birebir alıntı doğrulama (çevrimdışı) |
| `lit_evidence` | hayır | Hash-zincirli kanıt defterine kayıt ekleme (lit_ledger'ın yazı tarafı, çevrimdışı) |
| `lit_stats_check` | hayır | İstatistiksel raporlama denetimi: p-değeri/örneklem/güven aralığı tutarlılık bayrakları (çevrimdışı) |
| `lit_doi_normalize` | hayır | DOI normalleştirme ve doğrulama (doi.org/`doi:` öneklerini temizler, çevrimdışı) |
| `lit_pdf_provenance` | hayır | PDF sayfa kanıtlama: SHA-256, alıntı karakter aralıkları, tablo/şekil kutuları (çevrimdışı) |
| `lit_bm25_rank` | hayır | BM25 ile kanıt kısa listeleme: verilen özetler içinde sorguya göre sıralama (çevrimdışı, opsiyonel `rank_bm25`) |
| `plan_audit` | evet | plan-auditor CLI: mühürlü plan, kanıt zinciri, tamamlanma kapısı |
| `cds1_cli` | evet | cds CLI (scientific-computing-system v1, saf Python): calc/stats/integrate/units/constants/plot/sample/hypothesis/prompt/modules |
| `repocraft_cli` | evet | repocraft CLI: doğrulanmış spesifikasyondan deterministik Python proje iskeleti |
| `nomosguard_cli` | evet | nomosguard CLI: güvenlik akıl yürütme — kanıt defteri, fail-closed politika kapısı |
| `sra_cli` | evet | sra CLI (scientific-reasoning-auditor): makale akıl yürütme denetimi — audit/review-template/review-model/verify-stats |
| `polyguard_cli` | evet | polyguard CLI (polyglot-code-guard): AI üretimi kod için fail-closed doğrulama |
| `polyglot_cli` | evet | polyglot-python CLI: kendi dilinde Python — TR dahil 8 dil transpiler (run/translate/check/locales) |
| `eq_route` | hayır | eq-layer routing: mesaj için niyet/duygu/repair analizi ve yönlendirme önerisi |

Kayıtlı toplam **42 araç** (7 çekirdek + 35 eklenti aracı); CLI altı gruba ayırır (`packages/core/src/tools/grouping.js`):

- **File & code** — core file and shell operations: read, write, edit, list, search, run.
- **AI agents** — parallel sub-agents via `task`, each with its own context.
- **Scientific computation** — math expressions, unit conversion, physical constants, statistics, matrices, molar mass, CSV stats, Python eval.
- **Scientific package bridges** — CLI bridges to the user's open scientific packages (axiomize, cds/cds2, repocraft, nomosguard, sra, polyguard, polyglot-python) plus eq-layer routing.
- **Literature (evidence chain)** — OpenAlex/Europe PMC/Crossref search, citation and retraction checks, full-text reading, citation-graph traversal, data/code availability, quote verification, methodology audit, PRISMA-style screening, bibliography export, hash-chained evidence ledger, statistical-reporting checks, DOI normalization, PDF page provenance, BM25 evidence shortlisting.
- **Plan verification** — sealed-plan audit with a SHA-256 evidence chain and fail-closed completion gate.

**Bilimsel eklentiler** (`sci-tools`, `sci-extra`, `sci-data`, `sci-chem`, `sci-furox`, `sci-quantum`, `sci-lit`, `sci-audit`) modele hesap yapma, literatür ve doğrulama gücü kazandırır: model işleri uydurmak yerine bu araçlarla yapar.

**Deterministik kanıt kapısı (v0.10.7):** "uydurmaya yasak" yalnızca prompt düzeyinde değil. Bir koşuda **hiç araç çalışmadan** sayısal/istatistik/ölçüm/literatür iddiası içeren bir final yanıt gelirse ajan döngüsü (`packages/core/src/agent.js`) iddiayı yakalar, `warning` olayı yayınlar ve modeli tek turda aracıyla doğrulamaya zorlar; ikinci turda da araç çağrılmazsa sonuç `unverified: true` + `unverifiedClaims` ile işaretlenir ve CLI uyarıyı kırmızı gösterir. `runAgentLoop({ grounding: false })` ile kapatılabilir.

**Kullanıcının açık depolarından entegrasyon** (12 depo bağlı):
- [axiomize](https://github.com/Furox-Art/axiomize) + [scientific-computing-system-2.0](https://github.com/Furox-Art/scientific-computing-system-2.0) → `sci-furox` köprü araçları (pip)
- [quantum-reasoning-skill](https://github.com/Furox-Art/quantum-reasoning-skill) → `sci-quantum` akıl yürütme protokolü (prompt)
- [literature-evidence-mcp](https://github.com/Furox-Art/literature-evidence-mcp) → `sci-lit` literatür kanıt araçları (pip)
- [plan-auditor](https://github.com/Furox-Art/plan-auditor) → `sci-audit` plan doğrulama köprüsü (pip)
- [scientific-computing-system](https://github.com/Furox-Art/scientific-computing-system) → `cds1_cli` cds CLI v1 köprüsü (pip)
- [scientific-reasoning-auditor](https://github.com/Furox-Art/scientific-reasoning-auditor) → `sra_cli` makale denetimi köprüsü (pip)
- [polyglot-code-guard](https://github.com/Furox-Art/polyglot-code-guard) → `polyguard_cli` kod doğrulama köprüsü (pip) + SKILL.md becerisi
- [polyglot-python](https://github.com/Furox-Art/polyglot-python) → `polyglot_cli` transpiler köprüsü (pip)
- [repocraft](https://github.com/Furox-Art/deterministic-recipe-scaffolder) → `repocraft_cli` deterministik proje iskeleti köprüsü (pip)
- [nomosguard](https://github.com/Furox-Art/evidence-ledger-policy-gate) → `nomosguard_cli` güvenlik akıl yürütme köprüsü (pip)
- [eq-layer](https://github.com/Furox-Art/eq-layer) → **otomatik ön-işleme**: her kullanıcı mesajında niyet/duygu routing'i çalışır, yönlendirme o turun sistem istemine eklenir (kalıcı geçmiş değişmez; `SCI_AGENT_EQ_DISABLE=1` ile kapatılır). Bilinçli olarak eklenmeyenler: scientific-toolkit-mcp (bağımlılık çakışması riski). Kurulum:

```bash
pip install numpy scipy pandas axiomize scientific-computing-system scientific-computing-system-2.0 literature-evidence-mcp plan-auditor polyglot-code-guard polyglot-python scientific-reasoning-auditor repocraft nomosguard "eq-layer[ml]"
```

## Beceri Sistemi

SciAgent, GitHub depolarındaki ajan becerilerini (SKILL.md) yükleyip ajanın sistem istemine ekler — Claude Code beceri modeliyle aynı fikir, kaynakları kendi depolarından.

- **Kaynak biçimi:** `github:kullanici/depo[/alt/yol]` (genel depolarda çalışır, anahtar gerekmez)
- **Varsayılan yüklü (9 beceri):** [quantum-reasoning-skill](https://github.com/Furox-Art/quantum-reasoning-skill) + [eq-layer](https://github.com/Furox-Art/eq-layer) + [polyglot-code-guard](https://github.com/Furox-Art/polyglot-code-guard) + [plan-auditor](https://github.com/Furox-Art/plan-auditor) + [nomosguard](https://github.com/Furox-Art/evidence-ledger-policy-gate) + [literature-evidence-mcp](https://github.com/Furox-Art/literature-evidence-mcp) + [scientific-computing-system](https://github.com/Furox-Art/scientific-computing-system) + [axiomize](https://github.com/Furox-Art/axiomize) + [scientific-computing-system-2.0](https://github.com/Furox-Art/scientific-computing-system-2.0)
- **CLI:** `/skills` (listele) · `/skills add github:kullanici/depo` (ekle; `sci-agent.config.json` dosyasına kalıcı yazılır)
- Yeni beceri eklemek için tek gereken: deponun kökünde (veya belirttiğin alt yolda) geçerli frontmatter'lı bir `SKILL.md`

## Bilimsel model geldiğinde

Özel bilimsel modeliniz hazır olduğunda yapılacaklar kod değişikliği gerektirmez:

1. **Modeli bağla:** `sci-agent.config.json` içinde `baseUrl`, `name` (ve gerekirse `apiKey`).
2. **Model-özellikli eklenti ekle:** `packages/core/src/plugins.js` içindeki `BUILTINS` kaydına yeni bir eklenti tanımla: `tools` (modele özgü araçlar) ve `systemPrompt` (modele özgü davranış). Eklentiyi config'deki `plugins` listesine yaz; çekirdek döngü ve CLI aynı kalır.

Varsayılan sekiz eklenti (`sci-tools`, `sci-extra`, `sci-data`, `sci-chem`, `sci-furox`, `sci-quantum`, `sci-lit`, `sci-audit`) bu kancanın çalışan örnekleridir: 35 bilimsel/kanıt aracı + bilimsel davranış ve akıl yürütme istemleri.

## Verify it yourself

Bu README'deki sayıları repo kökünde tek komutlarla doğrulayabilirsin:

```bash
# Eklenti adları (beklenen: 8 eklenti)
node -e "import('./packages/core/src/plugins.js').then(m => console.log(m.listPlugins().map(p => p.name).join('\n')))"

# Kayıtlı araç sayısı (beklenen: 42)
node -e "import('./packages/core/src/index.js').then(async m => { const r = await m.createRegistry({ cfg: m.DEFAULT_CONFIG }); console.log(r.tools.length) })"

# Varsayılan beceri kaynakları (beklenen: 9 github: kaynağı)
node -e "import('./packages/core/src/index.js').then(m => console.log(m.DEFAULT_CONFIG.skills.sources))"

# CLI ve çekirdek test süiti
node --test "test/**/*.test.js"
```

## Yol haritası

- [ ] Özel bilimsel model hookup'ı: model kullanıcı tarafından sağlanacak — sağlayıcı bağlama ve gerçek uç noktayla uçtan uca deneme
- [ ] Daha fazla literatür köprüsü
- [ ] CLI kurulumunu iyileştirme (mevcut kurulum betikleri: `scripts/setup.ps1` / `scripts/setup.sh`)

## Lisans

Çift lisans: **MIT OR Apache-2.0** — LICENSE-MIT ve LICENSE-APACHE dosyalarına bakın. Apache-2.0 patent hakkını açıkça verir; MIT kısa ve basittir, kullanıcı ikisinden birini seçebilir.

## Durum

v0.10.7 — v0.10.6'nın üzerine: Linux/macOS Python betik çözümlemesi (`bin/`, tireli modül adları), alt süreç sızıntısı ve askıda kalma düzeltmeleri, deterministik kanıt kapısı (araçsız sayısal/literatür iddiası → uyarı + doğrulama turu, `unverified` işareti), README/config senkronu ve iki yeni varsayılan beceri (axiomize, scientific-computing-system-2.0). Proje yalnızca CLI ve çekirdek motor ile dağıtılır. Gerçek model uç noktasıyla uçtan uca deneme, model bağlandığında yapılmalı.
