// Static game data: tribes, epochs, units, buildings, techs, culture + comedy text.

export type ResKind = 'pangan' | 'kayu' | 'emas';
export interface Cost { pangan?: number; kayu?: number; emas?: number }
export type Role = 'warga' | 'prajurit' | 'pemanah' | 'siege' | 'hero';
export type BRole = 'tc' | 'house' | 'barracks' | 'reactor';
export type TribeId = 'jawa' | 'sunda';

export interface UnitDef {
  id: string; role: Role; name: string; model: string; scale: number;
  hp: number; speed: number; dmg: number; range: number; cd: number; sight: number; radius: number;
  cost: Cost; time: number; pop: number; epoch: number; desc: string;
  buildingMult?: number; poison?: boolean;
}
export interface BuildingDef {
  id: string; role: BRole; name: string; model: string; size: number; hp: number;
  cost: Cost; time: number; epoch: number; produces: Role[]; popCap: number; desc: string;
}
export interface EpochDef { name: string; blurb: string; cost: Cost; time: number; quote: string }
export interface TechEffect {
  buildSpeed?: number; dmg?: number; hp?: number; gather?: number; speed?: number; rangedDmg?: number; radResist?: number;
}
export interface TechDef { id: string; name: string; epoch: number; cost: Cost; time: number; desc: string; wisdom: string; effect: TechEffect }
export interface TribeDef {
  id: TribeId; name: string; tagline: string; color: string; icon: string;
  epochs: EpochDef[]; units: Record<Role, UnitDef>; buildings: Record<BRole, BuildingDef>; techs: TechDef[];
  bonuses: string[]; passive: { gatherPangan: number; gatherKayu: number; infHp: number; forestSpeed: number };
  nuke: { name: string; blurb: string };
  hero: { ability: string; abilityDesc: string; cooldown: number };
  advisor: { name: string; short: string };
  barks: Record<Role, string[]>;
  wisdom: string[];
}

export const RES_ICON: Record<ResKind, string> = { pangan: '🌾', kayu: '🪵', emas: '🪙' };
export const RES_NAME: Record<ResKind, string> = { pangan: 'Pangan', kayu: 'Kayu', emas: 'Emas' };

export const START_RES: Cost = { pangan: 260, kayu: 220, emas: 120 };
export const NUKE = {
  cost: { emas: 400, pangan: 200 } as Cost,
  countdown: 20,         // seconds from launch order to impact
  flight: 4.5,           // missile in the air
  radius: 9,             // cells
  waveSpeed: 30,         // cells / s
  cooldown: 100,
  falloutTime: 28, falloutRadius: 7, falloutDps: 4,
};

const U = (u: Partial<UnitDef> & Pick<UnitDef, 'id' | 'role' | 'name' | 'model'>): UnitDef => ({
  scale: 1, hp: 50, speed: 2.6, dmg: 5, range: 1.2, cd: 1, sight: 9, radius: 0.35,
  cost: {}, time: 10, pop: 1, epoch: 1, desc: '', ...u,
});

const JAWA: TribeDef = {
  id: 'jawa', name: 'Jawa', icon: '🪭', color: '#d8a23a',
  tagline: 'Keraton, keris, dan gamelan. Pelan-pelan asal kelakon… sampai nuklirnya jatuh.',
  epochs: [
    { name: 'Zaman Padepokan', blurb: 'Sawah, gotong royong, dan kopi tubruk.', cost: {}, time: 0, quote: 'Alon-alon asal kelakon.' },
    { name: 'Kerajaan Mataram', blurb: 'Keraton berdiri, wayang tampil, pemanah menyebar.', cost: { pangan: 200, kayu: 150 }, time: 25, quote: 'Gusti, pajak kita naik lagi?' },
    { name: 'Perlawanan Nusantara', blurb: 'Becak dipasangi meriam. Jangan tanya kenapa.', cost: { pangan: 400, kayu: 300, emas: 200 }, time: 35, quote: 'Becak pun punya harga diri!' },
    { name: 'Era Atom Gamelan', blurb: 'Gong dan reaktor bersatu. Tetangga mulai khawatir.', cost: { pangan: 700, kayu: 600, emas: 500 }, time: 45, quote: 'Namanya juga teknologi… yang penting ada slametannya.' },
  ],
  units: {
    warga: U({ id: 'warga_jawa', role: 'warga', name: 'Petani Padepokan', model: 'warga_jawa', hp: 40, dmg: 4, cost: { pangan: 50 }, time: 8, desc: 'Menggarap sawah dan menebang kayu. Caping adalah baju zirahnya.' }),
    prajurit: U({ id: 'prajurit_jawa', role: 'prajurit', name: 'Prajurit Keris', model: 'prajurit_jawa', hp: 100, dmg: 11, speed: 2.7, cost: { pangan: 45, kayu: 35 }, time: 10, desc: 'Keris, tombak, dan perisai bundar. Kokoh dan disiplin.' }),
    pemanah: U({ id: 'pemanah_jawa', role: 'pemanah', name: 'Pemanah Mataram', model: 'pemanah_jawa', hp: 55, dmg: 9, range: 7, cd: 1.3, epoch: 2, cost: { pangan: 30, kayu: 50 }, time: 11, desc: 'Memanah dari jauh sambil mengutip pepatah.' }),
    siege: U({ id: 'siege_jawa', role: 'siege', name: 'Becak Meriam', model: 'siege_jawa', hp: 230, dmg: 45, range: 9, cd: 3, speed: 2.1, radius: 0.6, epoch: 3, pop: 3, buildingMult: 2.5, cost: { kayu: 150, emas: 120 }, time: 20, desc: 'Becak dengan meriam Cetbang. Tukangnya minta tip.' }),
    hero: U({ id: 'hero_jawa', role: 'hero', name: 'Semar', model: 'hero_jawa', hp: 260, dmg: 8, range: 1.6, cd: 1.2, epoch: 2, pop: 3, radius: 0.5, cost: { pangan: 150, emas: 100 }, time: 25, desc: 'Punakawan paling sakti. Wejangannya menyembuhkan pasukan.' }),
  },
  buildings: {
    tc: { id: 'tc_jawa', role: 'tc', name: 'Keraton Joglo', model: 'tc_jawa', size: 4, hp: 2600, cost: {}, time: 0, epoch: 1, produces: ['warga', 'hero'], popCap: 12, desc: 'Pusat pemerintahan. Jika runtuh, kita kalah.' },
    house: { id: 'house_jawa', role: 'house', name: 'Omah Joglo', model: 'house_jawa', size: 2, hp: 360, cost: { kayu: 60 }, time: 14, epoch: 1, produces: [], popCap: 6, desc: '+6 populasi.' },
    barracks: { id: 'barracks_jawa', role: 'barracks', name: 'Pendopo Prajurit', model: 'barracks_jawa', size: 3, hp: 1200, cost: { kayu: 150 }, time: 30, epoch: 1, produces: ['prajurit', 'pemanah', 'siege'], popCap: 0, desc: 'Melatih prajurit, pemanah, dan becak meriam.' },
    reactor: { id: 'reactor_jawa', role: 'reactor', name: 'Reaktor Gamelan', model: 'reactor_jawa', size: 3, hp: 900, cost: { kayu: 300, emas: 300, pangan: 200 }, time: 45, epoch: 4, produces: [], popCap: 0, desc: 'Meluncurkan Gunungan Atomik. Harap tidak dipukul gong sembarangan.' },
  },
  techs: [
    { id: 'gotong_royong', name: 'Gotong Royong', epoch: 1, cost: { pangan: 100, kayu: 80 }, time: 20, desc: 'Bangunan selesai 50% lebih cepat.', wisdom: '“Berat sama dipikul, ringan sama dijinjing.”', effect: { buildSpeed: 0.5 } },
    { id: 'gamelan_perang', name: 'Gamelan Perang', epoch: 2, cost: { pangan: 200, emas: 100 }, time: 30, desc: 'Semua pasukan +12% serangan.', wisdom: '“Harmoni mengalahkan kebisingan.”', effect: { dmg: 0.12 } },
    { id: 'memayu_hayuning', name: 'Memayu Hayuning Bawana', epoch: 3, cost: { pangan: 300, emas: 250 }, time: 40, desc: 'Pasukan +15% HP dan kebal 50% radiasi.', wisdom: '“Menjaga keselamatan dunia.”', effect: { hp: 0.15, radResist: 0.5 } },
  ],
  bonuses: ['Petani panen pangan +20%', 'Prajurit +15% HP', 'Semar: Wejangan menyembuhkan pasukan sekitar', 'Gunungan Atomik: awan jamur berbentuk gunungan wayang'],
  passive: { gatherPangan: 1.2, gatherKayu: 1.0, infHp: 1.15, forestSpeed: 1.0 },
  nuke: { name: 'Gunungan Atomik', blurb: 'Gunungan wayang, tapi dengan kilatan yang bisa dilihat dari Madura.' },
  hero: { ability: 'Wejangan', abilityDesc: 'Menyembuhkan 90 HP pasukan dalam radius 5. “Nak, jangan lupa istirahat.”', cooldown: 18 },
  advisor: { name: 'Semar', short: 'Semar' },
  barks: {
    warga: ['Alon-alon asal kelakon, Ndoro.', 'Ngopi dulu, baru panen.', 'Sawahnya subur, dompetnya enggak.', 'Siap! Eh, tapi boleh nambah gaji?'],
    prajurit: ['Keris sudah diasah, Gusti!', 'Maju terus! Tapi jangan lari-lari ya.', 'Nuwun sewu, musuh!', 'Sedumuk bathuk, senyari bumi!'],
    pemanah: ['Panah siap, anginnya pas.', 'Mau yang kena atau yang meleset, Gusti?', 'Fokus… tarik… oh ada nyamuk.', 'Satu panah, satu pepatah.'],
    siege: ['Becaknya penuh, Gusti!', 'Meriam siap, tipnya?', 'Argo becak, bukan Argo Bromo!', 'Ngeeeng… DUAR!'],
    hero: ['Wejangan Semar: jangan panik.', 'Ora usah kemrungsung, Le.', 'Aku Semar, yang sakti dan pelupa.', 'Hmm… tadi mau apa ya?'],
  },
  wisdom: ['Ing ngarsa sung tuladha, ing madya mangun karsa, tut wuri handayani.', 'Aja dumeh. Jangan mentang-mentang punya nuklir.', 'Sugih tanpa bandha, digdaya tanpa aji.'],
};

const SUNDA: TribeDef = {
  id: 'sunda', name: 'Sunda', icon: '🎋', color: '#3fb27f',
  tagline: 'Leuweung hejo, kujang tajam, angklung merdu. Silih asih, silih asah, silih asuh.',
  epochs: [
    { name: 'Kampung Leuweung', blurb: 'Imah panggung, huma, dan seruling bambu.', cost: {}, time: 0, quote: 'Hayu atuh digawe!' },
    { name: 'Kerajaan Pajajaran', blurb: 'Pasukan kujang menjaga hutan larangan.', cost: { pangan: 200, kayu: 150 }, time: 25, quote: 'Pajajaran heurin ku tangtung!' },
    { name: 'Perjuangan Priangan', blurb: 'Angkot dipasangi baja. Sopirnya ngetem di medan perang.', cost: { pangan: 400, kayu: 300, emas: 200 }, time: 35, quote: 'Kiri, Pir! Eh, kanan, ada musuh!' },
    { name: 'Era Atom Angklung', blurb: 'Bambu bergoyang, reaktor bergetar. Tolong jangan goyang terlalu kencang.', cost: { pangan: 700, kayu: 600, emas: 500 }, time: 45, quote: 'Cing, tong poho nyalakeun alarm radiasi.' },
  ],
  units: {
    warga: U({ id: 'warga_sunda', role: 'warga', name: 'Peladang Huma', model: 'warga_sunda', hp: 40, dmg: 4, cost: { pangan: 50 }, time: 8, desc: 'Memikul hasil bumi dengan pikulan bambu.' }),
    prajurit: U({ id: 'prajurit_sunda', role: 'prajurit', name: 'Pasukan Kujang', model: 'prajurit_sunda', hp: 88, dmg: 11, speed: 3.1, cost: { pangan: 45, kayu: 35 }, time: 10, desc: 'Kujang lincah dan perisai bambu. Cepat dan gesit.' }),
    pemanah: U({ id: 'pemanah_sunda', role: 'pemanah', name: 'Penyumpit Leuweung', model: 'pemanah_sunda', hp: 52, dmg: 7, range: 6.5, cd: 1.2, epoch: 2, poison: true, cost: { pangan: 30, kayu: 50 }, time: 11, desc: 'Sumpit beracun dari balik rimbun. Racunnya bikin lemas.' }),
    siege: U({ id: 'siege_sunda', role: 'siege', name: 'Angkot Tempur', model: 'siege_sunda', hp: 270, dmg: 34, range: 8.5, cd: 2.6, speed: 2.9, radius: 0.7, epoch: 3, pop: 3, buildingMult: 2.5, cost: { kayu: 150, emas: 120 }, time: 20, desc: 'Angkot berlapis baja. Ngetem di depan markas lawan.' }),
    hero: U({ id: 'hero_sunda', role: 'hero', name: 'Cepot', model: 'hero_sunda', hp: 240, dmg: 9, range: 1.6, cd: 1.1, epoch: 2, pop: 3, radius: 0.5, cost: { pangan: 150, emas: 100 }, time: 25, desc: 'Punakawan wajah merah. Bodorannya bikin musuh lupa menyerang.' }),
  },
  buildings: {
    tc: { id: 'tc_sunda', role: 'tc', name: 'Imah Panggung Agung', model: 'tc_sunda', size: 4, hp: 2400, cost: {}, time: 0, epoch: 1, produces: ['warga', 'hero'], popCap: 12, desc: 'Pusat kampung. Jika runtuh, kita kalah.' },
    house: { id: 'house_sunda', role: 'house', name: 'Imah Panggung Leutik', model: 'house_sunda', size: 2, hp: 320, cost: { kayu: 60 }, time: 14, epoch: 1, produces: [], popCap: 6, desc: '+6 populasi.' },
    barracks: { id: 'barracks_sunda', role: 'barracks', name: 'Bale Pasukan', model: 'barracks_sunda', size: 3, hp: 1100, cost: { kayu: 150 }, time: 30, epoch: 1, produces: ['prajurit', 'pemanah', 'siege'], popCap: 0, desc: 'Melatih pasukan kujang, penyumpit, dan angkot tempur.' },
    reactor: { id: 'reactor_sunda', role: 'reactor', name: 'Reaktor Angklung', model: 'reactor_sunda', size: 3, hp: 900, cost: { kayu: 300, emas: 300, pangan: 200 }, time: 45, epoch: 4, produces: [], popCap: 0, desc: 'Meluncurkan Tumpeng Pamungkas. Dimainkan dengan nada do-re-mi-DUAR.' },
  },
  techs: [
    { id: 'silih_asih', name: 'Silih Asih, Silih Asah, Silih Asuh', epoch: 1, cost: { pangan: 100, kayu: 80 }, time: 20, desc: 'Semua pekerja memanen +15% lebih cepat.', wisdom: '“Saling mengasihi, mengasah, dan mengasuh.”', effect: { gather: 0.15 } },
    { id: 'leuweung_larangan', name: 'Leuweung Larangan', epoch: 2, cost: { pangan: 200, emas: 100 }, time: 30, desc: 'Pasukan +15% kecepatan, pemanah +15% serangan.', wisdom: '“Leuweung ruksak, cai beak, rakyat balangsak.”', effect: { speed: 0.15, rangedDmg: 0.15 } },
    { id: 'hirup_sauyunan', name: 'Hirup Sauyunan', epoch: 3, cost: { pangan: 300, emas: 250 }, time: 40, desc: 'Pasukan +10% HP dan kebal 50% radiasi.', wisdom: '“Hidup rukun dan sepakat.”', effect: { hp: 0.1, radResist: 0.5 } },
  ],
  bonuses: ['Penebang kayu +20%', 'Pasukan kujang bergerak lebih cepat', 'Cepot: Bodoran membuat musuh tertawa dan berhenti menyerang', 'Tumpeng Pamungkas: awan jamur berbentuk tumpeng'],
  passive: { gatherPangan: 1.0, gatherKayu: 1.2, infHp: 1.0, forestSpeed: 1.0 },
  nuke: { name: 'Tumpeng Pamungkas', blurb: 'Tumpeng raksasa dengan lauk ledakan. Tanpa kerupuk.' },
  hero: { ability: 'Bodoran', abilityDesc: 'Musuh dalam radius 5 tertawa dan terhenti 4 detik. “Ceuk Cepot… eh, kenapa tadi?”', cooldown: 20 },
  advisor: { name: 'Cepot', short: 'Cepot' },
  barks: {
    warga: ['Hayu atuh digawe!', 'Ngala kudu menta, Juragan.', 'Padi geus beukah, ayeuna rek ngaliwet.', 'Sakeudeung deui… keur istirahat.'],
    prajurit: ['Kujang geus diasah, Gan!', 'Maju, tapi rapih nya.', 'Hayang perang? Sok.', 'Hirup kudu wani!'],
    pemanah: ['Sumpit ready, wind check.', 'Kena geura, teu kena nyalahkeun angin.', 'Racunnya organik, Juragan.', 'Sst… musuh di balik daun.'],
    siege: ['Kiri, Pir! Ngetem sebentar!', 'Angkotnya penuh, meriamnya juga!', 'Ongkos tembak, Juragan!', 'Neng, naik? Naik meriam!'],
    hero: ['Cepot di dieu, Juragan!', 'Heureuy teh jalan ninja.', 'Ceuk Cepot mah nuklir teh gede!', 'Dawala! Eh, salah orang.'],
  },
  wisdom: ['Kudu bisa ngaji diri, ngaji batur.', 'Ulah gumede, mun boga nuklir mah.', 'Buruk-buruk papan jati: tetap bisa jadi reaktor.'],
};

export const TRIBES: Record<TribeId, TribeDef> = { jawa: JAWA, sunda: SUNDA };

// ---------------------------------------------------------------- advisor lines (Punakawan)
export const ADVISOR = {
  start: {
    jawa: ['Gusti, perang dimulai! Ingat: alon-alon asal kelakon, asal jangan kelamaan.', 'Ngapunten, Gusti. Musuh sudah di seberang. Sawah kita aman… semoga.'],
    sunda: ['Juragan! Perang dimulai. Kudu sabar, tapi jangan sabar-sabar teuing.', 'Hayu atuh! Musuh geus di ditu. Kita cicing wae? Heueuh, ngga.'],
  },
  houseNeeded: {
    jawa: ['Rumah kurang, Gusti! Warga pada tidur di emperan keraton.', 'Populasi mentok! Ayo bikin omah, bukan bikin alasan.'],
    sunda: ['Imahna kurang, Juragan! Warga pada ngadu di saung.', 'Populasi nepi! Hayu ngawangun imah.'],
  },
  epoch: {
    jawa: ['Zaman baru, Gusti! Semoga celananya masih muat.', 'Naik zaman! Kopi tubruk kini versi premium.'],
    sunda: ['Jaman anyar, Juragan! Mudah-mudahan teu poho jati diri.', 'Naik jaman! Sarung teh tetep kudu dipake.'],
  },
  built: {
    jawa: ['Bangunan jadi! Kata orang, kalau dibangun pakai gotong royong, rayap pun ikut bantu.'],
    sunda: ['Wangunan geus anggeus! Mantap, kayu teh teu aya nu dipaling.'],
  },
  attacked: {
    jawa: ['Awas, Gusti! Ada yang nyerang! Siapa yang lupa mengunci pagar?', 'Musuh datang! Tenang… tenang… eh, yang tenang duluan kena.'],
    sunda: ['Awas, Juragan! Musuh nyerang! Naha teu ngetuk heula?', 'Aya serangan! Tong gugup, kujang urang masih ngagantung.'],
  },
  nukeSelf: {
    jawa: ['Waduh Gusti! Tombolnya kepencet… tapi sekalian saja kita lanjut!', 'Gunungan Atomik meluncur! Mohon jauhi gamelan.'],
    sunda: ['Eh Juragan, tombol kepencet! Ya wis, ledakkeun wae!', 'Tumpeng Pamungkas mangkat! Ulah poho nyalakeun angklung.'],
  },
  nukeEnemy: {
    jawa: ['AWAS GUSTI! Musuh luncurkan nuklir! Lari ke sawah… eh jangan, itu juga kena!', 'Peringatan! Roket atom menuju kita. Segera evakuasi, bawa ketupat!'],
    sunda: ['AWAS JURAGAN! Musuh ngaluncurkeun nuklir! Lalar ka leuweung!', 'Peringatan! Roket atom datang. Cing, cing ka gunung!'],
  },
  nukeCancel: {
    jawa: ['Silo musuh runtuh! Peluncuran gagal. Katanya baterainya habis.', 'Rudal musuh batal! Mungkin kunci reaktornya ketinggalan di warung.'],
    sunda: ['Silo musuh ancur! Peluncuran gagal. Meureun colokannya kendor.', 'Nuklir batal! Kunci reaktor tinggal di warung.'],
  },
  nukeAfter: {
    jawa: ['Ya Gusti… sawahnya jadi gunungan.', 'Ledakannya cakep! Maaf, itu tadi tidak sopan.'],
    sunda: ['Duh Juragan… leuweungna jadi tumpeng.', 'Ledakannya mantep! Hapunten, teu sopan.'],
  },
  win: {
    jawa: ['Menang, Gusti! Slametan kambing guling untuk semua. Kecuali musuh.', 'Rampung! Keraton selamat. Sawah… ya sebagian.'],
    sunda: ['Meunang, Juragan! Tumpeng ageung keur sarerea!', 'Anggeus! Imah panggung salamet. Kebon… sabagian.'],
  },
  lose: {
    jawa: ['Keraton runtuh, Gusti… Tapi kata orang, kalah itu cuma menang yang tertunda.', 'Kita kalah. Tapi tenang, masih ada kopi.'],
    sunda: ['Imah runtuh, Juragan… Tapi saur kolot, eleh teh ngan meunang nu tinggaleun.', 'Kita eleh. Tapi tenang, masih aya kopi.'],
  },
  tips: [
    'Tips: klik kanan sawah atau pohon untuk menyuruh petani panen.',
    'Tips: Ctrl+angka menyimpan kelompok pasukan. Tekan angkanya untuk memanggil.',
    'Tips: reaktor baru bisa dibangun di Era Atom. Nuklir butuh emas!',
    'Tips: rudal bisa dibatalkan kalau silo penembaknya dihancurkan sebelum peluncuran.',
    'Tips: tekan H untuk kembali ke markas, A lalu klik untuk serang-sambil-jalan.',
  ],
};

// ---------------------------------------------------------------- map presets by region (province -> biome)
export interface MapPreset { seed: number; water: number; forest: number; mountain: number; paddy: number; sand: number; blurb: string }
export const REGION_PRESET: Record<string, Omit<MapPreset, 'seed'>> = {
  Sumatera: { water: 0.25, forest: 0.7, mountain: 0.25, paddy: 0.3, sand: 0.2, blurb: 'Hutan lebat, bukit barisan, dan sungai berliku.' },
  Jawa: { water: 0.18, forest: 0.45, mountain: 0.25, paddy: 0.65, sand: 0.15, blurb: 'Sawah bertingkat, gunung berapi, dan lembah subur.' },
  'Bali Nusa Tenggara': { water: 0.3, forest: 0.3, mountain: 0.25, paddy: 0.5, sand: 0.45, blurb: 'Pantai pasir, sawah terasering, dan savana.' },
  Kalimantan: { water: 0.38, forest: 0.85, mountain: 0.15, paddy: 0.2, sand: 0.15, blurb: 'Hutan hujan rimbun dan sungai-sungai besar.' },
  Sulawesi: { water: 0.28, forest: 0.5, mountain: 0.4, paddy: 0.35, sand: 0.25, blurb: 'Pegunungan terjal dan teluk-teluk dalam.' },
  Maluku: { water: 0.42, forest: 0.5, mountain: 0.2, paddy: 0.1, sand: 0.5, blurb: 'Gugusan pulau, pantai putih, dan hutan pala.' },
  Papua: { water: 0.2, forest: 0.7, mountain: 0.5, paddy: 0.1, sand: 0.15, blurb: 'Pegunungan menjulang dan rimba tak berujung.' },
};
