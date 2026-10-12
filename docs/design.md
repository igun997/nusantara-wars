# Nusantara Wars: ringkasan desain

Hasil sesi brainstorming (keputusan pengguna dicetak tebal).

- **Format:** skirmish **PvE melawan AI**, peta prosedural 128×128 per provinsi.
- **Suku:** **dua** (Jawa, Sunda), kontras: keraton, keris, gamelan vs imah panggung, kujang, angklung.
- **Epoch:** **sejarah alternatif komedi**, 4 epoch per suku, berangkat dari budaya asli lalu teknologi modern muncul dengan twist lucu (becak meriam, angkot tempur, reaktor gamelan/angklung).
- **Nuklir:** **senjata pamungkas pemain dan AI**; hitung mundur 20 d, bisa dibatalkan dengan menghancurkan silo, efek sinematik, tanah hangus, radiasi.
- **Peta Indonesia 3D:** **dipakai di menu** untuk memilih provinsi; bioma medan tempur mengikuti wilayah.
- **Arsitektur:** **A**: three.js + TypeScript + Vite, simulasi murni berbasis data (tick tetap 20 Hz) terpisah dari render.

## Kearifan lokal dalam mekanik
| Konsep | Mekanik |
|---|---|
| Gotong royong | Teknologi: bangunan selesai 50% lebih cepat |
| Harmoni (gamelan) | Teknologi: pasukan +12% serangan |
| Memayu hayuning bawana / Hirup sauyunan | Teknologi: ketahanan radiasi 50% |
| Silih asih, asah, asuh | Teknologi: panen +15% |
| Leuweung larangan | Teknologi: pasukan lebih cepat, pemanah lebih kuat |
| Sawah tumbuh lagi | Sawah meregenerasi pangan |
| Punakawan | Hero dengan kemampuan unik + penasihat yang melontarkan humor |

## Prinsip humor
Humor lahir dari situasi dan karakter (becak ber-meriam, "tombolnya kepencet", Cepot yang tidak bisa berhenti bercanda), tidak merendahkan budaya atau orang.
