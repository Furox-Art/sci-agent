SciAgent masaüstü paketleme — build kaynakları (buildResources)

Windows installer ikonu:
- electron-builder varsayılan olarak packages/desktop/ui/assets/icon.png
  (512x512) dosyasını okur ve otomatik olarak .ico'ya çevirir
  (electron-builder.yml -> win.icon).
- Kendi .ico dosyanızı kullanmak isterseniz bu klasöre (packages/desktop/build/)
  "icon.ico" adıyla (en az 256x256, çok boyutlu) yerleştirin; bu durumda
  electron-builder.yml içindeki win.icon satırını "icon.ico" ile değiştirin.

Yüklenici çıktısı packages/desktop/release/ klasörüne yazılır
(git'e eklenmez; bkz. packages/desktop/.gitignore).
