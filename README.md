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

## ChatGPT aboneliğiyle giriş (isteğe bağlı, yerel CLI)

Kendi ChatGPT hesabınızı SciAgent ile bağlayarak, hesabınız ve uygulama uygun olduğu takdirde ChatGPT planınızın izin verdiği AI isteklerini yapabilirsiniz. API anahtarınız gerekmez. Bu özellik OpenAI'nin [resmî Sign in with ChatGPT](https://developers.openai.com/siwc/quickstart) akışını kullanır. SciAgent özel depodur; kişisel yerel kullanımın dışındaki dağıtımların uygunluğu ve gerekli OpenAI onayı kullanıcı/geliştirici tarafından doğrulanmalıdır. [Kullanım şartları](https://openai.com/policies/sign-in-with-chatgpt-terms/). Bu entegrasyon OpenAI'nin onayladığı veya sponsor olduğu iddiasında değildir.

```bash
npm ci
npm run cli -- --chatgpt
```

İlk girişte yerel kasanız için bir parola oluşturun (ChatGPT parolanız değil). Kendi cihazınızda ve uygun kullanım kapsamında olduğunuzu doğrulayın. Tarayıcı OpenAI giriş sayfasını açar; hesabınızı seçip abonelik kullanımı iznini verin. Terminal hesabın kullanılabilir model kataloğunu getirir. Sonraki açılışlarda yerel kasayı açıp model seçebilirsiniz.

Hesap yönetimi:
```bash
npm run cli -- auth login    # yeni hesap ekle veya kayıtlı hesabı yeniden yetkilendir
npm run cli -- auth status   # kayıtlı hesaplar ve izin durumu
npm run cli -- auth switch   # açıkça bir kayıtlı hesabı seç
npm run cli -- auth models   # aktif hesabın model kataloğu
npm run cli -- auth logout   # aktif hesabın yenilenebilir oturumunu sonlandır
npm run cli -- auth usage    # kullanım ve bağlantı yönetimi URL'si
```

ChatGPT modu yalnızca etkileşimli terminalde, açıkça `--chatgpt` seçildiğinde çalışır; `--prompt` ile gözetimsiz kullanıma izin vermez. Abonelik limitleri ve krediler OpenAI tarafından yönetilir. Hesaplar ayrı kayıtlar halinde tutulur; kota aşmak için hesap döndürme veya başkasının isteğini sizin aboneliğinizle yürütme desteklenmez. Kullanım ayarları: https://chatgpt.com/settings/usage. Mevcut API anahtarı/yerel model yolu (`npm run cli`) değişmez.

### Kimlik ve veri güvenliği

- Resmî OAuth Authorization Code + PKCE S256; rastgele state/nonce; sadece 127.0.0.1 üzerinde kısa ömürlü callback; OpenID issuer/audience/expiry/nonce ve JWKS imza kontrolü. Kimlik doğrulaması, plan kullanımı izniyle aynı şey değildir; açıkça verilen iki ilgili kapsam aranır.
- Tokenlar `~/.sci-agent-auth/chatgpt.enc` dosyasında scrypt + AES-256-GCM ile yerel parolanıza bağlı şifreli saklanır; çalışma alanı ayarlarına, oturum geçmişine veya araçlara geçirilmez. Parolayı unutursanız kasayı açamazsınız. Hesap bağlantısını ChatGPT ayarlarından iptal edip yeni bir yerel kasa oluşturun. Eşzamanlı işlem kilidi vardır; çökme sonrası `active.lock` kalırsa yalnızca diğer SciAgent işlemlerinin kapalı olduğunu doğrulayıp kilit dosyasını kaldırın. Kimlik doğrulanamayan token rotasyonunda yeniden giriş gerekir.
- Model çağrıları yalnızca resmî `https://api.openai.com/v1/models` ve `https://api.openai.com/v1/responses` adreslerine gider. Responses akışı `store:false, stream:true` ile yürütülür; tamamlanmamış akışlar araç yürütmez. API tokenı komut satırına veya ortam değişkenlerine konulmaz. Bu, sağlayıcının veri saklama politikalarının tümü için bir garanti değildir.
- İstemler ve araştırma için kullanılan araç çıktıları seçilen model sağlayıcısına gönderilir. Yapılandırılmış bağımsız hakem modelleri kendi uç noktalarını kullanabilir. ChatGPT modu eski sohbetleri yüklemez veya otomatik sohbet geçmişi yazmaz; açık kullanıcı `/save` komutu ve isteğe bağlı bilimsel bellek politikaları geçerlidir.
- Shell/Python ve değişiklik yapan araçların mevcut onay gereklilikleri korunur; otomatik onay yalnızca okuma araçlarıyla sınırlandırılır. SciAgent'in genel amaçlı yerel kod yürütmesi tam işletim sistemi sandbox'ı değildir. Güvenmediğiniz projeleri veya komutları çalıştırmayın. Şifreli kasa, cihazınıza veya çalışan sürece tam erişimi olan saldırgana karşı garanti değildir.
- Çıkışta mümkün olduğunda yenileme tokenı iptal edilir ve yerel tokenlar temizlenir; uzaktan iptal doğrulanamazsa açıkça belirtilir. OpenAI ayarlarından da bağlantıyı kaldırabilirsiniz.

Bu ilk entegrasyon sentetik OAuth/JWT verisi ve simüle edilmiş Responses akışıyla test edilmiştir. Gerçek kullanıcı hesabı ve model uç noktasıyla uçtan uca kabul testi yapılmamıştır. Windows/macOS tarayıcı açma ve terminal gizli parola girişi gerçek cihazlarda ayrıca sınanmalıdır. Kullanılabilirlik, model kataloğu ve plan izni OpenAI'nin sunucu tarafındaki kararına bağlıdır.

## Diğer kullanıcı hesabı sağlayıcıları

Sağlayıcı seçim menüsü:

```bash
npm run cli -- --provider-menu
```

ChatGPT, GitHub Copilot, OpenRouter, mevcut API anahtarı/yerel model yapılandırması veya ayrı yerel Claude Code ve Gemini/Antigravity ajan oturumları arasından seçim yapılır. Hesap modları isteğe bağlı ve etkileşimlidir. Normal CLI akışı değişmez.

### GitHub Copilot

[Resmî Copilot SDK](https://github.com/microsoft/copilot-sdk) (`@microsoft/copilot-sdk` 2.0.3, isteğe bağlı bağımlılık) üzerinden cihazda oturum açmış kullanıcının Copilot hesabı kullanılır. Node 20.19+ veya 22.12+ ve uygun platform paketi gerekir. GitHub Copilot CLI kurulum ve yetkilendirme adımları için [resmî kılavuz](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/authenticate-copilot-cli).

```bash
npm run cli -- auth copilot login
npm run cli -- --copilot
npm run cli -- auth copilot status
npm run cli -- auth copilot models
npm run cli -- auth copilot switch
npm run cli -- auth copilot logout
npm run cli -- auth copilot usage
```

İlk girişte resmî `copilot login` komutu kullanılır (Windows'ta doğrudan terminalde çalıştırın). SciAgent GitHub tokenlarını okumaz veya saklamaz. Yalnızca GitHub.com üzerinde kayıtlı kullanıcı kimliği kabul edilir; ortam değişkeni, gh CLI ve BYOK giriş türleri reddedilir. Model kataloğunda yalnızca Copilot sağlayıcı kimliği açıkça belirtilen ve devre dışı olmayan kayıtlar seçilebilir; kaynak atfı olmayan modeller dışarıda bırakılır. Model seçimi mevcut aboneliğinizin yetki ve kullanım sınırlarına tabidir.

SDK ayrı, boş çalışma dizininde ve `empty` modunda çalışır; kendi yerel araçları, konfigürasyon keşfi, dosya kancaları ve becerileri kapalıdır. Modelden SciAgent araç çağrıları JSON protokolüyle istenir; yalnızca tanımlı araçlar SciAgent'in mevcut onay ve kanıt kapısından geçerek yürütülür. Bu, Copilot'un kendi yerel araçlarını kullanmakla aynı değildir; modelin JSON protokolüne uymaması isteğin güvenli biçimde reddedilmesine yol açar. SDK oturumları her model çağrısı sonunda kapatılır ve silinir; sağlayıcının veri saklama politikalarının tümü için garanti değildir. Kullanıcı hesabını değiştirmek/çıkış yapmak için SciAgent'i kapatıp resmî Copilot CLI'da `/user switch` veya `/logout` kullanılır. Uygulama yetkisini GitHub ayarlarından ayrıca iptal edebilirsiniz.

### OpenRouter

[Resmî OAuth PKCE](https://openrouter.ai/docs/guides/overview/auth/oauth) başsız terminal akışı kullanılır: tarayıcıdaki hesabınızla yetki verdikten sonra verilen tek kullanımlık kodu terminale yapıştırırsınız. Kullanıcının kendi OpenRouter kredilerine bağlı bir API anahtarı oluşturulur; bu, sınırsız abonelik değildir. Harcamalar ve fiyatlar sağlayıcıya/modelinize göre değişir.

```bash
npm run cli -- --openrouter
npm run cli -- auth openrouter login
npm run cli -- auth openrouter status
npm run cli -- auth openrouter models
npm run cli -- auth openrouter logout
npm run cli -- auth openrouter usage
```

OAuth sırasında kullanıcı kredi limitini USD olarak önceden belirler; OpenRouter onay ekranında nihai limit ve 30 günlük varsayılan süre düzenlenebilir. Model kataloğu araç çağrısını destekleyen modelleri listeler. Anahtar mevcut yerel scrypt/AES-GCM şifreli kasada saklanır ve proje ayarlarına yazılmaz. Çıkış yerel anahtarı kaldırır; uzaktaki anahtarın iptali için gösterilen OpenRouter anahtar ayarları bağlantısını kullanın. Anahtar yeniden bağlandığında önceki anahtar otomatik iptal edilmez.

Her iki mod da açık kullanıcı onayıyla istemleri ve seçilen araç çıktıları ilgili sağlayıcıya gönderir; eski sohbetleri otomatik yüklemez veya sohbet geçmişi yazmaz. Mevcut CLI bilimsel kayıtları ve açık kullanıcı kaydetme komutları geçerlidir. Gerçek abonelik/kredi hesabıyla giriş ve model çağrısı kabul testi yapılmamıştır; OpenRouter testleri sentetik HTTP yanıtları, Copilot adaptör testleri SDK taklitleri kullanır. SDK'nın gerçek başlatılması ve yetkisiz kullanıcı reddi Linux'ta doğrulanmıştır. Sağlayıcı şartları ve ticari dağıtım uygunluğu ayrıca incelenmelidir.

## Claude Code ve Gemini / Antigravity: yerel ajan oturumları

Bu iki seçenek, SciAgent'in model sağlayıcıları değildir. T3 Code ve editörlerin yerel ajan entegrasyonuna benzer biçimde, kullanıcının açıkça seçtiği ayrı bir resmî ajan oturumu başlatılır. SciAgent'in bilimsel araç kataloğu, hakemleri, araştırma belleği ve kanıt kapısı bu oturumlarda otomatik çalışmaz; yerel ajan kendi araçları ve izin sistemiyle çalışır. Çıktısı SciAgent tarafından bilimsel olarak onaylanmış sayılmaz. Abonelik uygunluğunu, kullanılabilir modelleri, ek ücretleri ve kotayı sağlayıcı belirler. Hiçbir sağlayıcıyla iş ortaklığı veya dağıtım onayı iddia edilmez.

### Claude Code (değiştirilmemiş resmî CLI)

Önce Anthropic'in [resmî Claude Code kurulumunu](https://code.claude.com/docs/en/setup) yapın. SciAgent, `PATH` üzerindeki kullanıcının yüklediği resmî `claude` çalıştırılabilir dosyasını kullanır. OAuth tokenlarını okumaz, oturumu kopyalamaz, Anthropic kimlik doğrulama seçeneklerini engellemez ve SDK üzerinden tüketici aboneliğini başka bir modele dönüştürmez.

```bash
npm run cli -- auth claude login
npm run cli -- auth claude status
npm run cli -- --claude --workspace /path/to/project
npm run cli -- auth claude logout
npm run cli -- auth claude usage
```

Oturumda model, izin ve hesap seçimi Claude Code'un kendi terminal arayüzündedir. Hesap ve ücretlendirme kullanıcının kendi Anthropic sözleşmesine veya Claude Code'da seçtiği yetkili sağlayıcıya bağlıdır. Claude Code'u bir ürün içinde çalıştırma/dağıtma koşulları için [Anthropic Legal and Compliance](https://code.claude.com/docs/en/legal-and-compliance) belgesini okuyun; ilgili ticari koşullara uymak gerekir. Bu entegrasyon, üçüncü taraf Claude.ai OAuth girişi veya programatik abonelik arka ucu değildir.

### Gemini / Google Antigravity (resmî ACP)

[Antigravity CLI](https://antigravity.google/docs/cli/acp) yüklenmeli ve `agy acp --help` desteklenmelidir. Google hesabınızla giriş, Google'ın resmî terminal yetkilendirme komutunda gerçekleşir:

```bash
npm run cli -- auth gemini login
npm run cli -- --gemini --workspace /path/to/project
npm run cli -- auth gemini version
npm run cli -- auth gemini status
npm run cli -- auth gemini logout
npm run cli -- auth gemini usage
```

SciAgent, standart ACP v1 istemcisi olarak değiştirilmeyen `agy acp` işlemini başlatır ve resmî `@agentclientprotocol/sdk` (2.12.0) üzerinden stdio JSON-RPC ile konuşur. İstemleri yalnızca etkileşimli terminalde kullanıcı yazar. Model kataloğu ACP oturumunda model yapılandırması olarak bildirilmişse `/model` ile seçim yapılabilir; katalog bildirilmediyse ajan varsayılanı geçerlidir. `/exit` oturumu kapatır, Ctrl+C devam eden turu iptal eder; ikinci Ctrl+C bağlantıyı kapatır. Hesap durumu ve çıkış resmî `agy` oturumunda yönetilir; `auth gemini status` bilgi mesajıdır, bir OAuth durum sorgusu değildir. `auth gemini native` doğrudan resmî terminali açar.

İstemci dosya sistemi/terminal/MCP sunucusu yeteneklerini ilan etmez; bu tür istemciye yöneltilen talepler desteklenmez. ACP izin talepleri, aynı oturuma ve aktif tura ait olduğunda ve somut giriş ayrıntıları gösterilebildiğinde kullanıcıya sorulur. Yalnız bir kerelik onay verilebilir; kalıcı izin otomatik seçilmez. Ajanın kendi çalışma alanı izinleri ve araçları yine Antigravity tarafından yönetilir; bu istemci işletim sistemi sandbox'ı değildir. Ajanın kendi önceden onaylanmış izinleri geçerli olabilir.

Google, Antigravity'nin resmî ACP istemcisi olarak kullanımı belgelendirir ancak tüketici aboneliğinin üçüncü taraf ajan arka ucu veya otomatik hesap döndürme şeklinde kullanılmasını desteklemez. [Google ACP belgesi](https://antigravity.google/docs/cli/acp), [Google Antigravity FAQ](https://antigravity.google/docs/faq). Bu yüzden iki yerel ajan da SciAgent'in otomatik `--prompt` ve alt ajan/model sağlayıcısı akışlarından ayrıdır; özel uç nokta, proxy, kimlik taklidi veya token çıkarma kullanılmaz. Yerel ajan uygulamaları kendi hesabınızın tüm ayarlarıyla çalışır; güvenmediğiniz çalışma alanlarını açmayın.

Doğrulama: Linux cihazında Claude Code 2.1.332 ve Antigravity CLI 1.5.11 sürümleri görüldü. Boş kullanıcı dizininde gerçek Antigravity ACP v1 initialize bağlantısı doğrulandı; gerçek abonelikle oturum açma, model seçme ve çıkarım kabul testi yapılmadı. Sentetik ACP oturumlarında izin reddi, model seçimi, iptal, bağlantı ve protokol uyumsuzluğu test edildi. Windows/macOS yerel terminal devri ayrıca test edilmelidir.

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
| `/research` | Son araştırma turunun kanıt, hipotez, analiz ve hakem kayıtlarını göster |
| `/memory save [etiket]` | Son araştırma durumunu çalışma alanında kalıcı sakla |
| `/memory search [sorgu]` / `/memory get <id>` | Kalıcı araştırma kayıtlarını ara / hash kimliğiyle oku |
| `/lesson stats` / `/lesson preflight` / `/lesson export` | Lesson-gate borç durumunu, ön kontrolü ve doğrulanmış kuralları göster |
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
| `research_hypothesis` | hayır | Hipotez kaydı, önceden tanımlı testler, kanıta bağlı değerlendirme |
| `research_causal` | hayır | Verilen DAG üzerinde backdoor koşulu ve asgari gözlenen düzeltme kümeleri |
| `research_causal_audit` | hayır | Aday DAGların veriyle uyumu, koşullu bağımsızlık testleri, Holm düzeltmesi, zaman sırası ve düzeltme duyarlılığı |
| `research_experiment` | hayır | Kontrollü deney protokolü, tohumlu dengeli rastgeleleştirme, yaklaşık güç analizi |
| `research_uncertainty` | hayır | Gradyan ve korelasyonla birinci mertebe belirsizlik yayılımı |
| `research_reproduce` | hayır | Önceki hesaplamayı bağımsız algoritmayla yeniden üretme |
| `research_conflicts` | hayır | Yapılandırılmış iddialarda bağlama, yön ve birimlere göre çelişki adayları |
| `research_semantic` | hayır | Doğal dilden kaynak alıntılı iddia çıkarımı ve model destekli semantik karşılaştırma (NLI) |
| `research_memory` | evet | Kalıcı yerel araştırma kaydı: sakla, ara, getir |
| `research_lesson` | evet | Gerçek Lesson-gate defterini denetle veya hata kaydı ekle |
| `research_route` | hayır | Problem türüne göre araç sıralaması ve tam araç kataloğu |
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

Kayıtlı toplam **53 araç** (18 çekirdek + 35 eklenti aracı); CLI yedi gruba ayırır (`packages/core/src/tools/grouping.js`):

- **File & code** — core file and shell operations: read, write, edit, list, search, run.
- **AI agents** — parallel sub-agents via `task`, each with its own context.
- **Scientific computation** — math expressions, unit conversion, physical constants, statistics, matrices, molar mass, CSV stats, Python eval.
- **Scientific package bridges** — CLI bridges to the user's open scientific packages (axiomize, cds/cds2, repocraft, nomosguard, sra, polyguard, polyglot-python) plus eq-layer routing.
- **Literature (evidence chain)** — OpenAlex/Europe PMC/Crossref search, citation and retraction checks, full-text reading, citation-graph traversal, data/code availability, quote verification, methodology audit, PRISMA-style screening, bibliography export, hash-chained evidence ledger, statistical-reporting checks, DOI normalization, PDF page provenance, BM25 evidence shortlisting.
- **Plan verification** — sealed-plan audit with a SHA-256 evidence chain and fail-closed completion gate.
- **Research methodology** — causal DAGs, experimental design, uncertainty, independent numerical replay, structured conflicts, memory, Lesson-gate and dynamic routing.

**Bilimsel eklentiler** (`sci-tools`, `sci-extra`, `sci-data`, `sci-chem`, `sci-furox`, `sci-quantum`, `sci-lit`, `sci-audit`) modele hesap yapma, literatür ve doğrulama gücü kazandırır: model işleri uydurmak yerine bu araçlarla yapar.

### Araştırma protokolü

**İddia–kanıt kapısı:** Her araştırma turunda uygun bilimsel araçların başarılı çıktıları, araç adı, argümanları, benzersiz tur içi kimliği ve SHA-256 özetiyle kaydedilir. Sonuçtaki algılanan sayısal, istatistiksel ve literatür iddiaları kendi çıktılarına bağlanmalıdır. Örneğin `determinant = 4.000000000 [E1]` ancak E1 çıktısında bu ifade bulunuyorsa geçer. Nitel bir iddiayı denetlemek için ayrı satırda `CLAIM: kaynak metnindeki birebir ifade [E1]` kullanılır. Başarısız veya ilgisiz araç çağrıları kanıt yerine geçmez. İlk başarısızlıkta düzeltme istenir; ikinci başarısızlıkta sonuç gösterilmez ve `done: false, unverified: true` döner. Son metin denetlenmeden önce terminale aktarılmaz; araç olayları ve akıl yürütme akışı devam eder. `grounding: false` ile kapı programatik olarak kapatılabilir.

**Hipotez motoru:** `research_hypothesis` aracında `action: add` ile kimlik, hipotez, öngörü ve yanlışlayıcı tanımlanır. İsteğe bağlı `test` alanı; `tool`, `args`, `support`, `refute` içerir. Bu belirli hesaplama aracı aynı argümanlarla hipotez kaydından sonra çağrıldığında, önceden belirlenen çıktı ölçütleri otomatik değerlendirilir. Testsiz hipotezlerde `action: assess` ile `id`, `evidenceId`, `quote`, `direction` (supports/refutes) ve `rationale` verilir. Durumlar `active`, `supported_candidate`, `refuted_candidate`, `contested` olabilir. `action: list` durumları gösterir; çelişen kanıtlar silinmez. Aday durumları bilimsel doğruluk garantisi değildir.

**Hakem ve doğrulayıcı:** `task` aracı `researcher`, `reviewer`, `verifier` rollerini destekler. Son iki rol kendi model adı ve uç noktasıyla yapılandırılmalıdır. Örnek `sci-agent.config.json` ayarı (yer tutucuları kendi modellerinizle değiştirin):

```json
{
  "agent": {
    "requireIndependentReview": true,
    "roleModels": {
      "reviewer": {
        "name": "review-model",
        "baseUrl": "http://localhost:8001/v1",
        "stream": false
      },
      "verifier": {
        "name": "verify-model",
        "baseUrl": "http://localhost:8002/v1",
        "stream": false
      }
    }
  }
}
```

Her iki rol, ana modelden ve birbirinden farklı model adları kullanmalıdır. Uç noktalar ayrı olsa bile aynı model adı bağımsız kabul edilmez. Her rol kendine ait araç kanıtlarıyla yapılandırılmış support/reject/unresolved kararı üretir. Katı mod, algılanan her iddiada iki farklı rolün destek kararını ve geçerli kanıt bağlantısını ister; bir ret varsa sonuç tartışmalı olarak kalır. Katı mod varsayılan olarak kapalıdır (ikinci ve üçüncü model sağlanmadan genel CLI çalışabilsin). Rol uç noktaları yalnızca yapılandırılırsa çağrılır; görev içeriği ve araç gözlemleri ilgili uç noktaya gönderilir.

### Bilimsel yöntem ve kalıcı çalışma alanı

Nedensellik, deney, belirsizlik, yeniden üretim, yapılandırılmış çelişki ve doğal dil analizlerinin çıktıları son turun `/research` kaydındaki `analyses` alanına yazılır. Bellek ve Lesson-gate kendi kalıcı depolarını kullanır; yönlendirme araç kataloğunu döndürür. Araştırma kaydı bir iddianın doğruluğunu otomatik kanıtlamaz.

| Yöntem | Girdi ve çıktı | Bilimsel sınır |
|---|---|---|
| Nedensellik | `nodes, edges, treatment, outcome, observed?, adjustment?`; DAG doğrulaması, d-separation/backdoor, asgari düzeltme kümeleri | Kullanıcının verdiği grafiğe koşullu; gözlenemeyen/atlanmış karıştırıcılar ve nedensel keşif çözülmüş sayılmaz. Etki büyüklüğü hesaplanmaz. 12'den fazla adayda düzeltme kümesi verilmelidir. |
| Deney tasarımı | `arms, participants, seed, outcome, hypothesis, controls, analysisPlan`; dengeli tohumlu rastgele atama; `standardizedEffect, alpha, power` ile yaklaşık iki kollu örneklem hesabı | Sürekli sonuç, bağımsız gözlemler ve ortak varyans varsayımı; normal yaklaşım. Körleme, atama gizliliği, kayıp, etik ve ön kayıt ayrıca ele alınmalıdır. Katılımcı kodları anonim olmalıdır. |
| Belirsizlik | `estimate, unit, gradient, standardUncertainties, correlation?, coverageFactor?`; korelasyon matrisi pozitif yarı tanımlılık denetimi, doğrusal hata yayılımı | Birinci mertebe yaklaşım. Kapsama faktörü tek başına güven düzeyi değildir. |
| Tekrarlanabilirlik | `evidenceId`; bağımsız sayısal algoritmalar ve çıktı karşılaştırması (kapsam aşağıda) | Aşağıdaki genişletilmiş bağımsız sayısal işlemler. Dosya/Python/shell ve genel deneyler yeniden yürütülmez. Uyuşmazlık varsa bağlı sonuç kanıt kapısından geçemez. |
| Çelişki | `assertions`: kimlik, özne, ilişki, nesne, bağlam, olumsuzluk, kanıt ID ve birebir alıntı; isteğe bağlı birimli aralık | Yapılandırılmış iddialarda kural tabanlı semantik karşılaştırma. Ayrı research_semantic aracı doğal dil çıkarımı ve model destekli NLI yapar; adayların bilimsel değerlendirmesi gerekir. |
| Dinamik yönlendirme | İstem anahtar sözcükleriyle uygun araçların sıralaması; isteğe bağlı ilk adım dar liste | Bilinmeyen istemler ve sonraki araç adımları tam kataloğa döner; onay politikası değişmez. |

Çelişki ilişkileri: `increase`, `decrease`, `no_change`, `equals`, `is`, `causes`, `associated_with` ve tanımlı İngilizce/Türkçe eş anlamları. Sayısal aralık birimleri: g/kg/mg, m/cm/mm, s/min/h, fraction/%, 1. Yalnızca aynı normalize özne/nesne/bağlam karşılaştırılır. Aday çelişki kanıt metninin modelce yorumlanmasının doğru olduğunu ispatlamaz.

#### Doğal dil çıkarımı ve semantik denetim

`research_semantic` girdileri: `evidenceIds` (mevcut turdaki `lit_fulltext` kanıtları) ve/veya `texts` (her kayıt `label`, `text` içerir). En fazla altı kaynak, toplam 48000 karakter. Araç mevcut model sağlayıcısını ayrı, araç erişimsiz çağrılarda kullanır: önce en fazla 12 doğal dil iddiası çıkarır; sonra bütün iddia çiftlerini karşılaştırır. Çıktıdaki birebir alıntı, kaynak kimliği, hash ve metin karakter aralıkları kontrol edilir. Kaynak içindeki komutlar veri olarak ele alınır. Eksik, geçersiz veya uydurma alıntılı JSON kabul edilmez.

İlişkiler: çelişki, eşdeğerlik, tek yönlü içerim, uyumluluk, karşılaştırılamazlık ve belirsizlik. Belirsiz/hipotetik modalite veya farklı bağlam bildirildiğinde kesin ilişki adayları belirsiz olarak işaretlenir. Kullanıcının verdiği metin `supplied_text_not_verified` statüsündedir ve kanıt defterine otomatik alınmaz. Kaynak alıntısı doğrulanabilir; modelin önerme çıkarımı, bağlam eşdeğerliği ve semantik kararı henüz bağımsız doğrulanmaz. Aynı sağlayıcıyla yapılan iki çağrı iki bağımsız model değildir. Çelişki bulunmaması tutarlılığı kanıtlamaz. Gerçek model başarımı kullanılan modele bağlıdır.

#### Bağımsız yeniden hesaplama kapsamı

`research_reproduce` önceki tur-içi kanıtın kimliğiyle özgün çıktının SHA-256 bütünlüğünü denetler. Alternatif algoritmalar:

| İlk hesaplama | Bağımsız algoritma |
|---|---|
| Determinant | Laplace/kofaktör açılımı (en fazla 7×7) |
| Matris tersi | Adjugate/kofaktör (en fazla 7×7) |
| Matris çarpımı | Dış çarpım biriktirme (en fazla 10×10) |
| Betimsel istatistik | Welford çevrimiçi varyans ve sıralı medyan |
| Temel aritmetik | Operatör yığını (+, -, *, /, parantez, işaret, ondalık ve bilimsel gösterim) |
| Birim dönüşümü | Doğrudan oran / afin sıcaklık dönüşümü (kanonik birim sembolleri) |
| Belirsizlik | Doğrudan kuadratik kovaryans formu |

Sayısal yuvarlama kuralları ve sabit toleranslar kullanılır; uyuşmazlık bağlı iddianın yayımlanmasını engeller. Desteklenmeyen işlemler `unsupported` döner. Genel bilimsel Python kodu, değişebilir dosyalar, trigonometrik/transandantal fonksiyonlar ve fiziksel deneyler otomatik yeniden üretilmez. İkinci algoritma, bağımsız veri seti veya deney tekrarı değildir.

#### Veriyle nedensel model denetimi

`research_causal_audit` için `nodes`, `treatment`, `outcome`, `models` (her biri id ve yönlü edges), `data` (gözlenen değişkenlerin tam sayısal satırları) gerekir. İsteğe bağlı `observed`, `alpha`, `adjustment`, `temporalOrder` verilebilir. En fazla 20 düğüm, sekiz aday DAG, 10–5000 satır ve 200 benzersiz test. DAGların yerel Markov koşulundan türetilen gözlenebilir bağımsızlık öngörüleri, kısmi korelasyon ve asimptotik Fisher-z testleriyle karşılaştırılır. Holm düzeltmesi bütün adaylarda benzersiz test ailesine uygulanır. Gizli ebeveynler, sabit/kollineer değişkenler ve yetersiz serbestlik derecesi denetlenemeyen koşullar olarak işaretlenir. Zaman sırası ihlalleri ayrıca raporlanır.

Sonuçlar `incompatible_with_assumptions`, `not_rejected` veya `untestable` olarak ayrılır. Kullanıcının verdiği adjustment kümesinin reddedilmeyen adaylar boyunca backdoor geçerliliği ayrıca karşılaştırılır. Testler bağımsız gözlemler ve Gaussian/lineer koşullu bağımsızlık varsayımıyla sınırlıdır. Markov eşdeğerliği, ölçülmemiş karıştırıcılar, yanlış ölçüm, seçim yanlılığı ve doğrusal olmayan bağımlılıkların tümü çözülmez. Gözlemsel veriden mutlak DAG doğruluğu veya nedensel etki çıkarıldığı iddia edilmez.

#### Kalıcı bilimsel bellek ve Lesson-gate

`.sci-agent-research/memory/` SHA-256 içerik adresli, bütünlüğü kontrol edilen JSON kayıtlarıdır; farklı çalışma alanları ayrıdır. Kayıt kimliğiyle tekrar erişilir. `/memory save` açık kullanıcı komutudur; modelin `research_memory` aracı onay ister. Kayıtlar geçmiş kanıttır, mevcut turun kanıtı yerine geçmez. Varsayılan otomatik kayıt kapalıdır; araştırma verisi hassas olabilir. Kaydedilmiş araç çıktıları şifreli değildir, ancak dizin Git tarafından yok sayılır. Otomatik kayıt kullanılırsa tamamlanan, kısmi ve bloke edilmiş araştırma durumları ayrı etiketlenir.

Lesson-gate 0.1.0, Furox-Art/lesson-gate'in `d947fa8d6b71fe19f11b493d885cf65958a2d6a5` commit'indeki Python çekirdeği ve MIT lisansı ile birlikte dağıtılır. Python 3.11+ gerekir. Defter `.sci-agent-research/lessons/` altındadır ve çalışma alanından ayrılmaz. Etkinleştirildiğinde bütün ilgili açık/promoted kayıtlar model çağrısından önce ve sonuç yayımlanmadan önce denetlenir; hata veya doğrulanmamış borç varsa kapı kapanır. Son kanıt kapısı başarısızlığı kullanıcı verisi içermeyen genel bir ders olarak kaydedilir. Katı mod başlangıçta kapalıdır.

Fixtür komutları modelin Lesson-gate aracından yürütülmez. Kullanıcı upstream CLI ile olumlu/olumsuz testleri tanımlar ve doğrular. Proje kökünde örnek (yol ve testler kendi çalışma alanınıza ait olmalıdır):

```bash
python packages/core/src/science/vendor/lesson-gate/lesson_gate.py stats --store .sci-agent-research/lessons --json
python packages/core/src/science/vendor/lesson-gate/lesson_gate.py --help
```

Upstream `promote` ve `verify --record` komutlarının ayrıntıları [Lesson-gate](https://github.com/Furox-Art/lesson-gate) README'sindedir. Doğrulama komutlarını çalıştırmadan önce inceleyin. Bir geçmiş proof kaydı kodun sonradan değişmediğini ispatlamaz; değişiklikten sonra fixture'ları yeniden doğrulayın. Negatif fixture'ın başarısızlık sebebinin beklenen regresyon olduğunu kontrol edin.

Yapılandırma örneği:

```json
{
  "agent": {
    "researchMemory": { "autoSave": true },
    "lessonGate": { "enabled": true },
    "toolRouting": { "enabled": true, "shortlist": false }
  }
}
```

Varsayılan: `autoSave: false`, `lessonGate.enabled: false`, araç sıralama açık ve dar liste kapalı. Dar liste açılırsa ilk adımda ilgili araçlar sunulur; `research_route` ile tam katalog istenebilir. Bağımsız hakem modu için ayrı model uç noktaları gerekir.

**Sınırlar:** Birebir çıktı eşleşmesi genel doğal dil semantiği veya bilimsel doğruluk garantisi değildir. Kaynak grafiği, ölçüm varsayımları, deney koşulları, model bağımsızlığı ve hipotezler ayrıca bilimsel denetime tabidir. Python/shell çıktıları ve bibliyografik sorgu yankıları tek başlarına doğrulanmış kanıt sayılmaz.

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

# Kayıtlı araç sayısı (beklenen: 53)
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
