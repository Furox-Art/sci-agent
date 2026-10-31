# SciAgent — Bilimsel Kodlama Ajanı

Model-bağımsız, Claude benzeri bütünleşik bir kodlama ajanı: **çekirdek motor + CLI + masaüstü arayüz**. Özel bilimsel modelinizi OpenAI uyumlu bir API üzerinden bağlarsınız; ajan dosya okuma/yazma, arama ve terminal komutlarını **onay mekanizmasıyla** çalıştırır.

## Mimari

```
sci-agent/
├─ packages/
│  ├─ core/      # Ajan motoru: sağlayıcı arayüzü, araç sistemi, onay politikası, döngü
│  ├─ cli/       # Terminal arayüzü (sci-agent komutu)
│  └─ desktop/   # Yerel sunucu (SSE) + web arayüzü + Electron kabuğu
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

Masaüstü uygulaması için (Electron ikilisini indirir):

```bash
npm install --save-dev electron --workspace packages/desktop
```

## Model bağlama

1. `sci-agent.config.example.json` dosyasını `sci-agent.config.json` olarak kopyalayın ve düzenleyin (bu dosya git'e girmez).
2. Ya da ortam değişkenleri: `SCI_AGENT_BASE_URL`, `SCI_AGENT_API_KEY`, `SCI_AGENT_MODEL`, `SCI_AGENT_PROVIDER`.
3. Ya da masaüstü arayüzünde **Ayarlar** panelinden girin.

Örnek — Ollama:

```bash
SCI_AGENT_BASE_URL=http://localhost:11434/v1 SCI_AGENT_MODEL=komut-satiri-modeli npm run cli
```

Örnek — vLLM üzerinde barındırılan bilimsel model:

```bash
SCI_AGENT_BASE_URL=http://sunucu:8000/v1 SCI_AGENT_API_KEY=... SCI_AGENT_MODEL=bilimsel-model npm run server
```

Henüz model yoksa `SCI_AGENT_PROVIDER=mock` ile betikli sahte model kullanılabilir (arayüzü denemek için).

## Kullanım

```bash
npm run cli        # terminal ajanı (sci-agent)
npm run server     # tarayıcıda arayüz: http://127.0.0.1:8765
npm run desktop    # Electron penceresi
npm test           # otomatik testler
```

CLI komutları: `/help`, `/model`, `/tools`, `/clear`, `/exit`.
Tek seferlik görev: `node packages/cli/bin/sci-agent.js --prompt "görev"`.

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

**Bilimsel eklentiler** (`sci-tools`, `sci-extra`, `sci-data`, `sci-chem`, `sci-furox`, `sci-quantum`) modele hesap yapma gücü kazandırır: model sayısal işleri kendisi uydurmak yerine bu araçlarla hesaplar — bilimsel işlerde doğruluk ve kapsam ek bir sıçrama sağlar.

**Kullanıcının açık depolarından entegrasyon** (`sci-furox`, `sci-quantum`): [axiomize](https://github.com/Furox-Art/axiomize) ve [scientific-computing-system-2.0](https://github.com/Furox-Art/scientific-computing-system-2.0) (import `cds2`) pip ile kurulur; köprü araçları PATH'ten bağımsız Python çözücüsüyle (`pybridge`) çalışır. [quantum-reasoning-skill](https://github.com/Furox-Art/quantum-reasoning-skill) protokolü prompt eklentisi olarak gömüldü. Kurulum:

```bash
pip install numpy scipy pandas axiomize scientific-computing-system-2.0
```

## Bilimsel model geldiğinde

Özel bilimsel modeliniz hazır olduğunda yapılacaklar kod değişikliği gerektirmez:

1. **Modeli bağla:** `sci-agent.config.json` içinde `baseUrl`, `name` (ve gerekirse `apiKey`) — ya da arayüzdeki Ayarlar paneli.
2. **Model-özellikli eklenti ekle:** `packages/core/src/plugins.js` içindeki `BUILTINS` kaydına yeni bir eklenti tanımla: `tools` (modele özgü araçlar) ve `systemPrompt` (modele özgü davranış). Eklentiyi config'deki `plugins` listesine yaz; çekirdek döngü ve arayüz aynı kalır.

Varsayılan altı eklenti (`sci-tools`, `sci-extra`, `sci-data`, `sci-chem`, `sci-furox`, `sci-quantum`) bu kancanın çalışan örnekleridir: 12 bilimsel araç + bilimsel davranış/akıl yürütme istemleri.

## Yol haritası

- [x] Akış (streaming) yanıt desteği
- [x] Bul-değiştir düzenleme aracı (`edit_file`)
- [x] Paralel alt-ajanlar (`task`) ve eklenti mimarisi
- [x] Bilimsel araç seti: matematik-fizik (`sci-extra`), veri analizi (`sci-data`), kimya (`sci-chem`)
- [x] Kullanıcı depolarından köprü: axiomize + cds2 (`sci-furox`), quantum-reasoning protokolü (`sci-quantum`)
- [ ] literature-evidence-mcp entegrasyonu (literatür arama/kanıt zinciri — MCP sunucusu)
- [ ] Çoklu oturum ve proje geçmişi

## Durum

v0.5 — bilimsel Python yığını (numpy/scipy/pandas) ve kullanıcının pip paketleri (axiomize 1.14.x, cds2/scientific-computing-system-2.0 5.4.x) köprü araçlarıyla bağlandı; quantum-reasoning protokolü eklendi. 57 test geçti (atlama yok); gerçek numpy hesabı arayüzden onay akışıyla doğrulandı. Gerçek model uç noktasıyla uçtan uca deneme, model bağlandığında yapılmalı.
