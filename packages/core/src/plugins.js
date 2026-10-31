import { python_eval, csv_stats } from './science/sci-tools.js';

/**
 * Eklenti kancası: özel bilimsel model geldiğinde yeni bir eklenti tanımlanarak
 * modele özgü araçlar ve sistem istemi eklemeleri yüklenir (kod değişikliği gerekmez).
 */
const BUILTINS = {
  'sci-tools': {
    name: 'sci-tools',
    description: 'Bilimsel araç seti: Python çalıştırma, CSV istatistik',
    tools: [python_eval, csv_stats],
    systemPrompt:
      'Bilimsel mod: sayısal hesaplamaları mümkünse python_eval ile doğrula; tablosal veri için csv_stats kullan; sonuçları birim ve anlamlı basamak sayısıyla raporla; uydurma yapma, hesaplamayı araca yaptır.',
  },
};

export function getPlugin(name) {
  return BUILTINS[name] ?? null;
}

export function listPlugins() {
  return Object.values(BUILTINS).map(({ name, description }) => ({ name, description }));
}
