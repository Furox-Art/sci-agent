import { python_eval, csv_stats } from './science/sci-tools.js';
import { sciExtraTools } from './science/sci-extra.js';
import { stats_calc, matrix_ops } from './science/sci-data.js';
import { molar_mass } from './science/sci-chem.js';
import { sciFuroxTools } from './science/sci-furox.js';
import { lit_search, lit_verify, lit_quote } from './science/sci-lit.js';
import { plan_audit } from './science/sci-audit.js';

/**
 * Eklenti kancası: özel bilimsel model geldiğinde yeni bir eklenti tanımlanarak
 * modele özgü araçlar ve sistem istemi eklemeleri yüklenir (kod değişikliği gerekmez).
 * Her eklenti, modelin bilimsel işlerdeki yeteneğini araç desteğiyle artırır.
 */
const BUILTINS = {
  'sci-tools': {
    name: 'sci-tools',
    description: 'Temel bilimsel araç seti: Python çalıştırma, CSV istatistik',
    tools: [python_eval, csv_stats],
    systemPrompt:
      'Bilimsel mod: sayısal hesaplamaları mümkünse python_eval ile doğrula; tablosal veri için csv_stats kullan; sonuçları birim ve anlamlı basamak sayısıyla raporla; uydurma yapma, hesaplamayı araca yaptır.',
  },
  'sci-extra': {
    name: 'sci-extra',
    description: 'Matematik ve fizik araçları: ifade değerlendirme, birim dönüşümü, fizik sabitleri',
    tools: sciExtraTools,
    systemPrompt:
      'Matematik/fizik modu: sayısal ifadeleri zihinden değil math_eval ile hesapla; birim içeren her dönüşümde unit_convert kullan; fizik sabitlerine ihtiyaç duyduğunda physical_constants tablosundan al, değer uydurma.',
  },
  'sci-data': {
    name: 'sci-data',
    description: 'Veri analizi araçları: betimsel istatistik, korelasyon/regresyon, matris işlemleri',
    tools: [stats_calc, matrix_ops],
    systemPrompt:
      'Veri analizi modu: veri kümelerinde stats_calc ile istatistik ve regresyon hesapla; matris işlemlerini matrix_ops ile yap; sonuçları yorumlarken hesapladığın sayıların dışına çıkma.',
  },
  'sci-chem': {
    name: 'sci-chem',
    description: 'Kimya araçları: formülden mol kütlesi hesabı (118 element)',
    tools: [molar_mass],
    systemPrompt:
      'Kimya modu: mol kütlesi gerektiren her hesapta molar_mass aracını kullan; atom kütlelerini hafızadan verme.',
  },
  'sci-furox': {
    name: 'sci-furox',
    description:
      'Kullanıcının açık bilimsel paketleri (Furox-Art): axiomize (modelleme/birim doğrulama/belirsizlik/SBML) ve cds2 (scientific-computing-system-2.0: lineer cebir, ODE/PDE, Monte Carlo, istatistik, sinyal, kuantum simülasyonu) köprü araçları',
    tools: sciFuroxTools,
    systemPrompt:
      'Bilimsel yığın modu: numpy/scipy/pandas ve kullanıcı paketleri kurulu. Sayısal hesapları furox_compute ile yap (yığın otomatik yüklenir). Modelleme, birim/boyut doğrulama, kalibrasyon, belirsizlik analizi ve SBML/CellML/Modelica dışa aktarım için axiomize_cli (keşif: ["capabilities"]). Lineer cebir, ODE/PDE, kadratür, Monte Carlo, sinyal ve kuantum simülasyonu için cds2_cli (keşif: ["--help"]). Cevabı uydurma; bu araçlarla doğrula.',
  },
  'sci-quantum': {
    name: 'sci-quantum',
    description:
      'Akıl yürütme protokolü (Furox-Art/quantum-reasoning-skill v1.2.0, MIT): birden çok hipotezi açık tut, kanıtla çürüt, en güçlüye çök',
    tools: [],
    systemPrompt:
      'Zor/belirsiz/yüksek riskli bilimsel problemlerde şu protokolü uygula (basit sorularda kullanma): (1) Durumu çerçevele: amaç, doğrulanmış olgular, varsayımlar, araçlar; olguları hipotezlerden ayır. (2) Gerçekten farklı aday yollar aç — kozmetik varyant sayma; ortogonal sınıflar: doğrudan türetme, çürütme/karşıörnek, ayrıştırma, alternatif mekanizma, sayısal/çalıştırılabilir test, bağımsız yeniden kurma, rakip eleştiri. (3) Dalları active/dormant/rejected olarak izle; bir dal öne geçti diye diğerini kalıcı olarak reddetme. (4) Her dalı kanıtla, hitabetle değerlendir; modelin kendi özgüveni zayıf kanıttır. (5) Araçları onaylamak için değil çürütmek için kullan: öndeki dalı deviren kanıt ara (furox_compute/python_eval/axiomize_cli sayısal testleri idealdir). (6) Dalları karşılaştırırken ortak varsayımı taşıyanları çift sayma; bağımsız doğrulanan sonuçları pekiştir; yeni doğrulanan olguyu kısıtladığı her dala aktar. (7) Bütçeyi belirsizliğe göre ayarla: düşük belirsizlikte daral ve derinleş; yüksek belirsizlikte genişle. (8) Yeni kanıt öndeki varsayımı geçersiz kılarsa dormant dalı canlandır. (9) Aramanın marjinal değeri düştüğünde en iyi desteklenen cevaba çök; gerçekten çözülmemiş dallar kalırsa alternatifleri ve ayırt edici kanıtı açıkça raporla.',
  },
  'sci-lit': {
    name: 'sci-lit',
    description:
      'Literatür kanıt araçları (literature-evidence-mcp): OpenAlex/Europe PMC/Crossref arama, atıf eşleşme, retraksiyon kontrolü, tam metin alıntı doğrulama',
    tools: [lit_search, lit_verify, lit_quote],
    systemPrompt:
      'Literatür modu: literatür iddialarını hafızadan uydurma; lit_search ile arama yap, atıf verirken lit_verify ile DOI/retraksiyon kontrolü yap, alıntı gösterirken lit_quote ile tam metin eşleşmesini doğrula. Dış API başarısızsa bunu açıkça belirt.',
  },
  'sci-audit': {
    name: 'sci-audit',
    description:
      'Plan doğrulama (plan-auditor): mühürlü planlar, SHA-256 kanıt zinciri, STRIPS erişilebilirlik, fail-closed tamamlanma kapısı',
    tools: [plan_audit],
    systemPrompt:
      'Doğrulama modu: "bitti" demeden önce kanıt üret — çok adımlı işlerde plan_audit ile planı denetle ve komut çıktısını kanıt olarak göster.',
  },
};

export function getPlugin(name) {
  return BUILTINS[name] ?? null;
}

export function listPlugins() {
  return Object.values(BUILTINS).map(({ name, description }) => ({ name, description }));
}
