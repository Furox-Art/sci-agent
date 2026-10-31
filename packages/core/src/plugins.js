import { python_eval, csv_stats } from './science/sci-tools.js';
import { sciExtraTools } from './science/sci-extra.js';
import { stats_calc, matrix_ops } from './science/sci-data.js';
import { molar_mass } from './science/sci-chem.js';

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
};

export function getPlugin(name) {
  return BUILTINS[name] ?? null;
}

export function listPlugins() {
  return Object.values(BUILTINS).map(({ name, description }) => ({ name, description }));
}
