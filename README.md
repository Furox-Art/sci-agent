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
| `python_eval` | evet | Python kodu çalıştırır (bilimsel hesaplama; Python kurulu olmalı) |
| `csv_stats` | hayır | CSV sütunları için n/ortalama/ss/min/maks |

## Bilimsel model geldiğinde

Özel bilimsel modeliniz hazır olduğunda yapılacaklar kod değişikliği gerektirmez:

1. **Modeli bağla:** `sci-agent.config.json` içinde `baseUrl`, `name` (ve gerekirse `apiKey`) — ya da arayüzdeki Ayarlar paneli.
2. **Model-özellikli eklenti ekle:** `packages/core/src/plugins.js` içindeki `BUILTINS` kaydına yeni bir eklenti tanımla: `tools` (modele özgü araçlar) ve `systemPrompt` (modele özgü davranış). Eklentiyi config'deki `plugins` listesine yaz; çekirdek döngü ve arayüz aynı kalır.

Varsayılan `sci-tools` eklentisi bu kancanın çalışan örneğidir (python_eval, csv_stats + bilimsel davranış istemi).

## Yol haritası

- [x] Akış (streaming) yanıt desteği
- [x] Bul-değiştir düzenleme aracı (`edit_file`)
- [x] Paralel alt-ajanlar (`task`) ve eklenti mimarisi (`sci-tools`)
- [ ] Web araması, literatür (Zotero) entegrasyonu
- [ ] Çoklu oturum ve proje geçmişi

## Durum

v0.3 — paralel alt-ajanlar ve bilimsel eklenti mimarisi eklendi; 21 test + tarayıcıda görsel doğrulama yapıldı. `python_eval` bu makinede Python kurulmadan sınanamadı. Gerçek model uç noktasıyla uçtan uca deneme, model bağlandığında yapılmalı.
