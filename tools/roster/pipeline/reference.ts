/**
 * REFERANS TOHUMU -- kurulum verisini VERITABANINA yazar.
 *
 * NEDEN BU DOSYA VAR:
 *   Bu degerler once JSON dosyalarindaydi (`fc26-leagues.json`,
 *   `staff-pool.json`, `referee-pool.json`, `agent-pool.json`). Yanlisti:
 *   bir ligin hangi ulkede oldugu GERCEK VERIDIR ve gercek veri
 *   veritabaninda durur. Dosyada durdugu surece "dunyada ne var" sorusunun
 *   iki cevabi olurdu -- biri diskte, biri DB'de -- ve ikisi sessizce
 *   ayrisirdi.
 *
 * BU DOSYANIN ROLU:
 *   Tohumlama. Degerler buradan bir kez veritabanina AKAR; sonrasinda
 *   okuyan herkes (import hatti, motor, editor) yalnizca DB'ye bakar.
 *   Bir ligi degistirmek icin burayi degil, `ref_league` tablosunu
 *   duzenlemek yeterlidir -- tohum var olan satiri EZMEZ.
 *
 * EZMEME KURALI:
 *   Butun yazmalar `INSERT ... ON CONFLICT DO NOTHING`. Editorde elle
 *   duzeltilmis bir bant ya da eklenmis bir lig, bir sonraki import'ta
 *   geri alinmaz. Maske kilidiyle ayni ilke.
 */

import type { DatabaseSyncType } from '../sqlite.js';
import type { IssueLog } from '../db.js';

export interface ReferenceSeedResult {
  readonly leagues: number;
  readonly names: number;
  readonly bands: number;
  readonly distributions: number;
  readonly roles: number;
}

/**
 * LIG -> ULKE.
 *
 * FC26 anligindaki 51 ligin tamami. Varsayilan kapsam bunlarin bir
 * bolumunu kullanir; gerisi ulke filtresi genisletildiginde hazir durur.
 *
 * `promoted` / `relegated` kaynakta YOK -- seviye basina makul degerler.
 * Ulkeye ozel bir kontenjan gerekirse satir duzenlenir.
 */
const FC26_LEAGUES: readonly (readonly [string, string, string, number])[] = [
  // [league_id, ulke, lig adi, seviye]
  ['13', 'England', 'Premier League', 1],
  ['14', 'England', 'Championship', 2],
  ['60', 'England', 'League One', 3],
  ['61', 'England', 'League Two', 4],
  ['53', 'Spain', 'La Liga', 1],
  ['54', 'Spain', 'La Liga 2', 2],
  ['31', 'Italy', 'Serie A', 1],
  ['32', 'Italy', 'Serie B', 2],
  ['19', 'Germany', 'Bundesliga', 1],
  ['20', 'Germany', '2. Bundesliga', 2],
  ['2076', 'Germany', '3. Liga', 3],
  ['16', 'France', 'Ligue 1', 1],
  ['17', 'France', 'Ligue 2', 2],
  ['308', 'Portugal', 'Primeira Liga', 1],
  ['10', 'Netherlands', 'Eredivisie', 1],
  ['68', 'Türkiye', 'Süper Lig', 1],
  // --- varsayilan kapsam disi, ulke filtresi genisletilirse hazir
  ['1', 'Denmark', 'Superliga', 1],
  ['4', 'Belgium', 'Pro League', 1],
  ['7', 'Brazil', 'Série A', 1],
  ['39', 'United States', 'Major League Soccer', 1],
  ['41', 'Norway', 'Eliteserien', 1],
  ['50', 'Scotland', 'Premiership', 1],
  ['56', 'Sweden', 'Allsvenskan', 1],
  ['63', 'Greece', 'Super League', 1],
  ['64', 'Hungary', 'Nemzeti Bajnokság I', 1],
  ['65', 'Republic of Ireland', 'Premier Division', 1],
  ['66', 'Poland', 'Ekstraklasa', 1],
  ['80', 'Austria', 'Bundesliga', 1],
  ['83', 'Korea Republic', 'K League 1', 1],
  ['189', 'Switzerland', 'Super League', 1],
  ['313', 'Azerbaijan', 'Premyer Liqa', 1],
  ['317', 'Croatia', 'Hrvatska nogometna liga', 1],
  ['318', 'Cyprus', '1. Division', 1],
  ['319', 'Czechia', 'První liga', 1],
  ['322', 'Finland', 'Veikkausliiga', 1],
  ['330', 'Romania', 'Liga I', 1],
  ['332', 'Ukraine', 'Premier League', 1],
  ['335', 'Chile', 'Primera Division', 1],
  ['336', 'Colombia', 'Categoría Primera A', 1],
  ['337', 'Paraguay', 'División Profesional', 1],
  ['338', 'Uruguay', 'Primera División', 1],
  ['350', 'Saudi Arabia', 'Pro League', 1],
  ['351', 'Australia', 'A-League Men', 1],
  ['353', 'Argentina', 'Liga Profesional de Fútbol', 1],
  ['2012', 'China PR', 'Super League', 1],
  ['2013', 'United Arab Emirates', 'Pro League', 1],
  ['2017', 'Bolivia', 'División de Fútbol Profesional', 1],
  ['2018', 'Ecuador', 'Serie A', 1],
  ['2019', 'Venezuela', 'Primera Division', 1],
  ['2020', 'Peru', 'Liga 1', 1],
  ['2149', 'India', 'Super League', 1],
];

/** Seviye basina yukselme/dusme kontenjani. */
const PROMOTION: Readonly<Record<number, { promoted: number; relegated: number }>> = {
  1: { promoted: 0, relegated: 3 },
  2: { promoted: 3, relegated: 3 },
  3: { promoted: 3, relegated: 4 },
  4: { promoted: 4, relegated: 2 },
};

/**
 * ISIM HAVUZLARI.
 *
 * Ulkeye uygun, dogal ad/soyad kombinasyonlari. Gercek kisilerin adlarini
 * BIREBIR tasimamaya dikkat edildi; amac taninabilir bir futbol dunyasi
 * dokusu, kopya degil.
 */
const STAFF_NAMES: Readonly<Record<string, { first: readonly string[]; last: readonly string[] }>> = {
  'Türkiye': {
    first: ['Emre', 'Mert', 'Serkan', 'Okan', 'Volkan', 'Tolga', 'Cenk', 'Ilhan', 'Yusuf', 'Kerem'],
    last: ['Karaca', 'Yalcin', 'Aydin', 'Demirtas', 'Kocak', 'Tuncel', 'Bayrak', 'Cetin', 'Akgun', 'Ersoy'],
  },
  England: {
    first: ['James', 'Daniel', 'Michael', 'Stuart', 'Gareth', 'Neil', 'Craig', 'Simon', 'Lee', 'Ryan'],
    last: ['Whitmore', 'Carter', 'Hargreaves', 'Bellamy', 'Ashworth', 'Redfern', 'Kingsley', 'Marlowe', 'Stanton', 'Bramley'],
  },
  Spain: {
    first: ['Javier', 'Alberto', 'Ruben', 'Sergio', 'Ismael', 'Joaquin', 'Iker', 'Unai', 'Marcos', 'Aitor'],
    last: ['Olivares', 'Berrocal', 'Quintana', 'Salgado', 'Ferrando', 'Alcaraz', 'Bustamante', 'Cabanillas', 'Requena', 'Valdivia'],
  },
  Italy: {
    first: ['Marco', 'Luca', 'Stefano', 'Davide', 'Fabrizio', 'Alessio', 'Matteo', 'Riccardo', 'Nicola', 'Tommaso'],
    last: ['Bellani', 'Rovere', 'Castagno', 'Vanoli', 'Pedrini', 'Marchetto', 'Salvadori', 'Fontanella', 'Brunetti', 'Corradi'],
  },
  Germany: {
    first: ['Stefan', 'Jonas', 'Lukas', 'Andreas', 'Matthias', 'Torsten', 'Bernd', 'Florian', 'Sven', 'Marius'],
    last: ['Hellwig', 'Brandstatter', 'Neuhoff', 'Reinders', 'Kirchner', 'Wendler', 'Ostermann', 'Berghoff', 'Lindner', 'Vogtmann'],
  },
  France: {
    first: ['Julien', 'Thibault', 'Olivier', 'Mathieu', 'Cedric', 'Fabien', 'Damien', 'Romain', 'Yannick', 'Herve'],
    last: ['Marchand', 'Duverger', 'Lefevrin', 'Boucher', 'Cassagne', 'Peltier', 'Rondeau', 'Vasseur', 'Delaunay', 'Bonnefoy'],
  },
  Portugal: {
    first: ['Rui', 'Tiago', 'Bruno', 'Vitor', 'Nuno', 'Paulo', 'Hugo', 'Diogo', 'Filipe', 'Andre'],
    last: ['Salgueiro', 'Machado', 'Rebelo', 'Coutinho', 'Mendonca', 'Trindade', 'Carvalhal', 'Belmiro', 'Pires', 'Guedelha'],
  },
  Netherlands: {
    first: ['Dirk', 'Pieter', 'Joost', 'Maarten', 'Bas', 'Sander', 'Wouter', 'Koen', 'Thijs', 'Rens'],
    last: ['Veenstra', 'Hoogland', 'Brinkman', 'Doornbos', 'Grotenhuis', 'Verhoeven', 'Blankert', 'Smeets', 'Roosendaal', 'Kranenburg'],
  },
  // Bos ulke adi = VARSAYILAN havuz. Tanimsiz bir ulke buraya duser.
  '': {
    first: ['Andre', 'Marek', 'Ivan', 'Petar', 'Goran', 'Adrian', 'Viktor', 'Tomas', 'Milan', 'Nikola'],
    last: ['Novak', 'Petrovic', 'Kovacs', 'Horvat', 'Ilic', 'Szabo', 'Popa', 'Vidic', 'Lazar', 'Bogdan'],
  },
};

/**
 * TEKNIK HEYET NITELIK BANTLARI -- kulup tier'ina gore.
 *
 * Bantlar CAKISIR: zayif kulupte iyi hoca mumkun, sadece daha nadir.
 */
const STAFF_BANDS: Readonly<Record<string, Readonly<Record<string, readonly [number, number]>>>> = {
  elite: {
    tactical: [66, 92], training: [62, 88], development: [55, 85],
    motivation: [58, 88], man_management: [55, 86], discipline: [52, 85],
    experience: [8, 30], reputation: [70, 96],
  },
  contender: {
    tactical: [58, 84], training: [55, 82], development: [50, 80],
    motivation: [52, 82], man_management: [50, 80], discipline: [48, 80],
    experience: [5, 24], reputation: [55, 82],
  },
  mid: {
    tactical: [46, 74], training: [44, 72], development: [42, 74],
    motivation: [44, 76], man_management: [42, 74], discipline: [40, 74],
    experience: [3, 18], reputation: [38, 68],
  },
  lower: {
    tactical: [36, 66], training: [34, 64], development: [36, 70],
    motivation: [38, 70], man_management: [36, 68], discipline: [34, 68],
    experience: [1, 14], reputation: [22, 52],
  },
  amateur: {
    tactical: [28, 58], training: [26, 56], development: [30, 62],
    motivation: [32, 64], man_management: [30, 60], discipline: [28, 60],
    experience: [0, 10], reputation: [10, 38],
  },
};

/** Rol tanimlari -- kac kisi, hangi yasta, nitelikli mi. */
const STAFF_ROLES: readonly (readonly [string, number, number, number, number])[] = [
  // [rol, minYas, maxYas, nitelikli, kulupBasina]
  ['manager', 42, 66, 1, 1],
  ['assistant', 35, 55, 1, 1],
  ['sporting_director', 38, 60, 1, 1],
  ['president', 46, 70, 0, 1],
  ['doctor', 32, 60, 0, 1],
  ['physio', 28, 50, 0, 1],
];

/**
 * OYUN FELSEFESI DAGILIMI.
 *
 * `balanced` en kalabalik cunku cogu hoca bir uca savrulmaz. Taktik degeri
 * yuksek hocalarda `possession`/`pressing` agirlik kazanir (bkz. staff.ts).
 */
const STAFF_STYLES: readonly (readonly [string, number])[] = [
  ['balanced', 0.34],
  ['possession', 0.16],
  ['counter', 0.16],
  ['pressing', 0.14],
  ['defensive', 0.12],
  ['direct', 0.08],
];

/** Dizilisler. 4-4-2 iki kez cunku motorun sabit dizilisi o -- uyum sansi yuksek olmali. */
const STAFF_FORMATIONS: readonly (readonly [string, number])[] = [
  ['4-4-2', 2],
  ['4-3-3', 1],
  ['4-2-3-1', 1],
  ['3-5-2', 1],
  ['5-3-2', 1],
];

/** HAKEM isim havuzlari. */
const REFEREE_NAMES: readonly (readonly [string, readonly string[], readonly string[]])[] = [
  ["", ["Marco", "Luca", "Pierre", "Anton", "Felix", "Sergio", "Diego", "Ivan", "Michael", "Craig", "Anthony", "Stuart", "Lars", "Jonas", "Rui", "Joao", "Andre", "Daniel", "Tomas", "Nikola"], ["Rossi", "Bianchi", "Moreau", "Weber", "Fischer", "Navarro", "Costa", "Oliver", "Taylor", "Clark", "Andersen", "Nilsson", "Silva", "Pereira", "Kovac", "Horvat", "Dubois", "Lambert"]],
  ["Türkiye", ["Ali", "Mert", "Halil", "Serkan", "Emre", "Cuneyt", "Ozgur", "Deniz", "Volkan", "Yasin", "Arda", "Ufuk"], ["Yildiz", "Kaya", "Aksoy", "Demirci", "Ozkan", "Turan", "Bilgin", "Sahin", "Coskun", "Karaca", "Erdem", "Polat"]],
  ["England", ["Michael", "Craig", "Anthony", "Stuart", "Paul", "Andrew", "David", "Simon", "Chris", "Jarred"], ["Oliver", "Taylor", "Clark", "Atkinson", "Dean", "Madley", "Tierney", "Bramall", "Kavanagh", "England"]],
  ["Spain", ["Sergio", "Antonio", "Javier", "Jesus", "Alejandro", "Ricardo", "Carlos", "Pablo"], ["Navarro", "Munuera", "Gil", "Hernandez", "Soto", "Cordero", "Ortiz", "Delgado"]],
  ["Italy", ["Marco", "Luca", "Daniele", "Matteo", "Gianluca", "Federico", "Davide", "Simone"], ["Rossi", "Bianchi", "Orsato", "Massa", "Doveri", "Irrati", "Fabbri", "Colombo"]],
  ["Germany", ["Felix", "Anton", "Daniel", "Tobias", "Sascha", "Deniz", "Harm", "Patrick"], ["Weber", "Fischer", "Brych", "Zwayer", "Stegemann", "Aytekin", "Osmers", "Ittrich"]],
  ["France", ["Pierre", "Clement", "Benoit", "Willy", "Jerome", "Francois", "Stephanie", "Ruddy"], ["Moreau", "Dubois", "Bastien", "Turpin", "Delerue", "Letexier", "Brisard", "Buquet"]],
  ["Portugal", ["Rui", "Joao", "Artur", "Luis", "Tiago", "Nuno", "Fabio", "Manuel"], ["Costa", "Pereira", "Soares", "Dias", "Martins", "Almeida", "Veríssimo", "Godinho"]],
  ["Netherlands", ["Bas", "Danny", "Serdar", "Jeroen", "Dennis", "Allard", "Joey", "Sander"], ["Nijhuis", "Makkelie", "Gozubuyuk", "Manschot", "Higler", "Lindhout", "Kamphuis", "Blom"]],
];

/** MENAJER isim havuzlari. */
const AGENT_NAMES: readonly (readonly [string, readonly string[], readonly string[]])[] = [
  ["", ["Daniel", "Marco", "Peter", "Andre", "Victor", "Leon", "Ruben", "Stefan", "Mario", "Alex"], ["Brandt", "Nowak", "Keller", "Marchetti", "Ferrer", "Lindqvist", "Duarte", "Vasilev", "Horvat", "Almeida"]],
  ["England", ["Gary", "Neil", "Simon", "Craig", "Lewis", "Terry", "Owen", "Dean"], ["Whitlock", "Barnes", "Hargrave", "Coleridge", "Fenwick", "Marsden", "Ashby", "Rowntree"]],
  ["Spain", ["Iker", "Raul", "Joaquin", "Sergi", "Nacho", "Xabi", "Borja", "Aitor"], ["Velarde", "Quintana", "Salcedo", "Mendizabal", "Rojas", "Cabrera", "Ibanez", "Puig"]],
  ["Italy", ["Gianni", "Federico", "Enzo", "Matteo", "Silvio", "Dario", "Nico", "Piero"], ["Traversi", "Bonomi", "Falcone", "Riva", "Aglietti", "Sartori", "Costanzo", "Bellini"]],
  ["Türkiye", ["Kerem", "Onur", "Serkan", "Volkan", "Emre", "Tolga", "Barış", "Hakan"], ["Karabulut", "Aydemir", "Şengül", "Toprak", "Erdoğan", "Yalçın", "Doğanay", "Kırcı"]],
  ["Germany", ["Jens", "Torben", "Malte", "Kai", "Sven", "Nils", "Bernd", "Lars"], ["Ostermann", "Reinhardt", "Vogler", "Kuhnert", "Stadler", "Hellwig", "Brenner", "Dietz"]],
  ["France", ["Bruno", "Yann", "Cedric", "Olivier", "Thibault", "Farid", "Gael", "Pascal"], ["Rousset", "Meunier", "Delacroix", "Vasseur", "Bouchard", "Lasalle", "Perrin", "Garnier"]],
  ["Brazil", ["Wagner", "Cleber", "Juninho", "Everton", "Ademir", "Rogerio", "Caio", "Ivan"], ["Bastos", "Queiroz", "Machado", "Nogueira", "Peixoto", "Sarmento", "Vilela", "Rangel"]],
  ["Portugal", ["Tiago", "Nuno", "Rui", "Filipe", "Hugo", "Vitor", "Diogo", "Paulo"], ["Bettencourt", "Serrano", "Loureiro", "Guedes", "Palhares", "Amorim", "Falcao", "Tavares"]],
  ["Netherlands", ["Bram", "Joris", "Sander", "Teun", "Wouter", "Sjoerd", "Maarten", "Rik"], ["Vermeulen", "Hoekstra", "Dijkman", "Roelofs", "Bakhuis", "Vosmeer", "Kramer", "Sluis"]],
  ["Argentina", ["Hernan", "Damian", "Ariel", "Ezequiel", "Cristian", "Matias", "Ruben", "Lucas"], ["Bianchi", "Ferreyra", "Olmedo", "Zabala", "Cordero", "Aguirre", "Iriarte", "Solari"]],
];

/** HAKEM nitelik bantlari. '*' = kokarttan bagimsiz global aralik. */
const REFEREE_BANDS: readonly (readonly [string, string, number, number])[] = [
  ['*', 'strictness', 35, 85],
  ['*', 'cardTendency', 30, 85],
  ['*', 'penaltyCourage', 30, 90],
  ['*', 'varReliance', 20, 90],
  ['*', 'experience', 0, 250],
  ['regional', 'consistency', 35, 65],
  ['regional', 'reputation', 20, 45],
  ['regional', 'bias', 12, 12],
  ['national', 'consistency', 50, 78],
  ['national', 'reputation', 40, 70],
  ['national', 'bias', 8, 8],
  ['elite', 'consistency', 65, 88],
  ['elite', 'reputation', 65, 88],
  ['elite', 'bias', 5, 5],
  ['fifa', 'consistency', 75, 95],
  ['fifa', 'reputation', 80, 99],
  ['fifa', 'bias', 3, 3],
];

/** HAKEM kokart dagilimi. */
const REFEREE_BADGES: readonly (readonly [string, number])[] = [
  ['regional', 0.45],
  ['national', 0.35],
  ['elite', 0.15],
  ['fifa', 0.05],
];

/** MENAJER arketip dagilimi. */
const AGENT_ARCHETYPES: readonly (readonly [string, number])[] = [
  ['journeyman', 0.34],
  ['opportunist', 0.24],
  ['developer', 0.2],
  ['family', 0.12],
  ['super_agent', 0.1],
];

/** MENAJER arketip bantlari. */
const AGENT_BANDS: readonly (readonly [string, string, number, number])[] = [
  ['super_agent', 'reach', 85, 98],
  ['super_agent', 'negotiation', 80, 95],
  ['super_agent', 'loyalty', 15, 35],
  ['super_agent', 'patience', 20, 40],
  ['super_agent', 'commission', 0.12, 0.18],
  ['super_agent', 'reputation', 75, 99],
  ['family', 'reach', 20, 40],
  ['family', 'negotiation', 30, 50],
  ['family', 'loyalty', 90, 99],
  ['family', 'patience', 85, 95],
  ['family', 'commission', 0.03, 0.05],
  ['family', 'reputation', 10, 35],
  ['developer', 'reach', 45, 65],
  ['developer', 'negotiation', 50, 70],
  ['developer', 'loyalty', 65, 80],
  ['developer', 'patience', 70, 85],
  ['developer', 'commission', 0.06, 0.09],
  ['developer', 'reputation', 40, 65],
  ['opportunist', 'reach', 60, 80],
  ['opportunist', 'negotiation', 65, 85],
  ['opportunist', 'loyalty', 25, 45],
  ['opportunist', 'patience', 30, 50],
  ['opportunist', 'commission', 0.09, 0.14],
  ['opportunist', 'reputation', 45, 75],
  ['journeyman', 'reach', 35, 55],
  ['journeyman', 'negotiation', 40, 60],
  ['journeyman', 'loyalty', 55, 70],
  ['journeyman', 'patience', 60, 75],
  ['journeyman', 'commission', 0.05, 0.08],
  ['journeyman', 'reputation', 20, 50],
];

/** ELLE TANIMLI hakemler. */
const MANUAL_REFEREES: readonly { name: string; country: string; badge: string }[] = [
  { name: "Cuneyt Kara", country: "Türkiye", badge: 'fifa' },
  { name: "Bjorn Hale", country: "England", badge: 'elite' },
];

/** Sayisal ayarlar. */
const SETTINGS: readonly (readonly [string, string, number])[] = [
  ['referee', 'per_league', 8],
  ['agent', 'per_country', 6],
];

/**
 * KURATORLU MASKE ESLEMESI -- en yuksek oncelik.
 *
 * Bir ad burada varsa algoritma HIC calismaz. PES mantigi tam olarak
 * burada yasiyor: 'Manchester City' -> 'Manchester Blue',
 * 'Galatasaray' -> 'Istanbul Kirmizi'. Algoritma yalnizca listede
 * OLMAYAN kulupler icin devreye girer.
 *
 * ULKE SATIRLARI TASINMADI: cografya tescilli degil, ulke adlari
 * GERCEK kalir (bkz. country tablosu yorumu).
 */
const MASK_RULES: readonly (readonly [string, string, string])[] = [
  ["club", "Manchester City", "Manchester Blue"],
  ["club", "Manchester United", "Manchester Red"],
  ["club", "Galatasaray", "İstanbul Kırmızı"],
  ["club", "Fenerbahce", "İstanbul Lacivert"],
  ["club", "Besiktas JK", "İstanbul Siyah"],
  ["club", "Trabzonspor", "Karadeniz Bordo"],
  ["club", "Liverpool FC", "Merseyside Red"],
  ["club", "Everton FC", "Merseyside Blue"],
  ["club", "Arsenal FC", "North London Red"],
  ["club", "Tottenham Hotspur", "North London White"],
  ["club", "Chelsea FC", "West London Blue"],
  ["club", "West Ham United", "East London Iron"],
  ["club", "Newcastle United", "Tyneside Magpies"],
  ["club", "Aston Villa", "Birmingham Claret"],
  ["club", "Real Madrid", "Madrid Blanco"],
  ["club", "Atlético de Madrid", "Madrid Rojiblanco"],
  ["club", "FC Barcelona", "Barcelona Blaugrana"],
  ["club", "Sevilla FC", "Sevilla Rojiblanco"],
  ["club", "Valencia CF", "Valencia Naranja"],
  ["club", "Athletic Bilbao", "Bilbao Rojiblanco"],
  ["club", "AC Milan", "Milano Rossonero"],
  ["club", "Inter Milan", "Milano Nerazzurro"],
  ["club", "Juventus FC", "Torino Bianconero"],
  ["club", "SSC Napoli", "Napoli Azzurro"],
  ["club", "AS Roma", "Roma Giallorosso"],
  ["club", "SS Lazio", "Roma Biancoceleste"],
  ["club", "Bayern Munich", "München Rot"],
  ["club", "Borussia Dortmund", "Dortmund Gelb"],
  ["club", "Bayer 04 Leverkusen", "Leverkusen Schwarzrot"],
  ["club", "FC Schalke 04", "Gelsenkirchen Blau"],
  ["club", "Paris Saint-Germain", "Paris Bleu"],
  ["club", "Olympique Marseille", "Marseille Blanc"],
  ["club", "Olympique Lyon", "Lyon Bleu"],
  ["club", "AFC Ajax", "Amsterdam Rood"],
  ["club", "PSV Eindhoven", "Eindhoven Rood"],
  ["club", "Feyenoord Rotterdam", "Rotterdam Wit"],
  ["club", "FC Porto", "Porto Azul"],
  ["club", "SL Benfica", "Lisboa Vermelho"],
  ["club", "Sporting CP", "Lisboa Verde"],
];


/**
 * FC26 AD VARYANTLARI.
 *
 * Kuratorlu liste Transfermarkt yazimiyla hazirlanmisti ("Liverpool FC",
 * "Arsenal FC"); FC26 ayni kulubu baska yaziyor ("Liverpool", "Arsenal").
 * Olculdu: eslesmedigi icin Liverpool "Foxhall Old Mill", Arsenal "Redmoor
 * Eastfield" oluyordu -- yani en taninan kulupler taninmaz hale geliyordu.
 *
 * Ayni maskeye IKI ad baglanabilir; kilit `external_key` uzerinden
 * calistigi icin bu bir cakisma yaratmaz.
 */
const FC26_ALIASES: readonly (readonly [string, string])[] = [
  ['Liverpool', 'Merseyside Red'],
  ['Everton', 'Merseyside Blue'],
  ['Arsenal', 'North London Red'],
  ['Chelsea', 'West London Blue'],
  ['FC Bayern München', 'München Rot'],
  ['Atlético Madrid', 'Madrid Rojiblanco'],
  ['Athletic Club', 'Bilbao Rojiblanco'],
  ['Inter', 'Milano Nerazzurro'],
  ['Napoli', 'Napoli Azzurro'],
  ['Juventus', 'Torino Bianconero'],
  ['Roma', 'Roma Giallorosso'],
  ['Lazio', 'Roma Biancoceleste'],
  ['Olympique Lyonnais', 'Lyon Bleu'],
  ['Olympique de Marseille', 'Marseille Blanc'],
  ['Ajax', 'Amsterdam Rood'],
  ['PSV', 'Eindhoven Rood'],
  ['Feyenoord', 'Rotterdam Wit'],
  ['Fenerbahçe SK', 'İstanbul Lacivert'],
  ['Galatasaray SK', 'İstanbul Kırmızı'],
  ['Beşiktaş JK', 'İstanbul Siyah'],
  ['Trabzonspor', 'Karadeniz Bordo'],
];

/** ULKE SIFATLARI -- lig adlari bundan turer. */
const COUNTRY_ADJECTIVES: readonly (readonly [string, string])[] = [
  ["England", "English"],
  ["Spain", "Spanish"],
  ["Italy", "Italian"],
  ["Germany", "German"],
  ["France", "French"],
  ["Portugal", "Portuguese"],
  ["Netherlands", "Dutch"],
  ["Türkiye", "Turkish"],
  ["Belgium", "Belgian"],
  ["Scotland", "Scottish"],
  ["Denmark", "Danish"],
  ["Norway", "Norwegian"],
  ["Sweden", "Swedish"],
  ["Poland", "Polish"],
  ["Austria", "Austrian"],
  ["Switzerland", "Swiss"],
  ["Greece", "Greek"],
  ["Croatia", "Croatian"],
  ["Czechia", "Czech"],
  ["Romania", "Romanian"],
  ["Ukraine", "Ukrainian"],
  ["Brazil", "Brazilian"],
  ["Argentina", "Argentine"],
  ["Uruguay", "Uruguayan"],
  ["Colombia", "Colombian"],
  ["Chile", "Chilean"],
  ["Peru", "Peruvian"],
  ["Mexico", "Mexican"],
  ["United States", "American"],
  ["Japan", "Japanese"],
  ["Korea Republic", "Korean"],
  ["China PR", "Chinese"],
  ["Australia", "Australian"],
  ["Saudi Arabia", "Saudi"],
  ["India", "Indian"],
  ["Hungary", "Hungarian"],
  ["Finland", "Finnish"],
  ["Cyprus", "Cypriot"],
  ["Azerbaijan", "Azerbaijani"],
  ["Republic of Ireland", "Irish"],
  ["United Arab Emirates", "Emirati"],
  ["Bolivia", "Bolivian"],
  ["Ecuador", "Ecuadorian"],
  ["Venezuela", "Venezuelan"],
  ["Paraguay", "Paraguayan"],
];

/** MASKELEME SOZCUK HAVUZLARI. */
const WORD_POOLS: readonly (readonly [string, readonly string[]])[] = [
  ['club_distinctive', ['Blue','Red','White','Black','Green','Gold','Silver','Crown','Harbour','Ironside','Northgate','Southgate','Riverside','Old Mill','Cathedral','Foundry','Kingsway','Eastfield','Westbank','Highbridge']],
  ['place', ['Ashford','Barrow','Camden','Denbury','Eastmoor','Fairhaven','Greenock','Hallam','Irongate','Kelmore','Lyndale','Marlow','Northwick','Oakley','Pendle','Quarrow','Redmoor','Stanbridge','Thornby','Upton','Vale End','Westmere','Yarrow','Ashcombe','Brackley','Cranfield','Dunmore','Elmwood','Foxhall','Glenmore']],
  ['agency_suffix', ['Sports','Group','Management','Partners','International','Agency','Football','Talent','Union','Associates']],
];

export function seedReference(db: DatabaseSyncType, log: IssueLog): ReferenceSeedResult {
  const insLeague = db.prepare(
    `INSERT INTO ref_league(
       source_kind, source_league_id, country_name, league_name, level, promoted, relegated)
     VALUES ('fc26', ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_kind, source_league_id) DO NOTHING`,
  );
  const insName = db.prepare(
    `INSERT INTO ref_name_pool(entity_kind, country_name, part, value)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(entity_kind, country_name, part, value) DO NOTHING`,
  );
  const insBand = db.prepare(
    `INSERT INTO ref_attribute_band(entity_kind, band_key, attribute, min_value, max_value)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(entity_kind, band_key, attribute) DO NOTHING`,
  );
  const insDist = db.prepare(
    `INSERT INTO ref_distribution(entity_kind, bucket, key, weight)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(entity_kind, bucket, key) DO NOTHING`,
  );
  const insRule = db.prepare(
    `INSERT INTO ref_mask_rule(entity_kind, name_real, name_masked) VALUES (?, ?, ?)
     ON CONFLICT(entity_kind, name_real) DO NOTHING`,
  );
  const insWord = db.prepare(
    `INSERT INTO ref_word_pool(bucket, value) VALUES (?, ?)
     ON CONFLICT(bucket, value) DO NOTHING`,
  );
  const insSetting = db.prepare(
    `INSERT INTO ref_setting(entity_kind, key, value) VALUES (?, ?, ?)
     ON CONFLICT(entity_kind, key) DO NOTHING`,
  );
  const insManual = db.prepare(
    `INSERT INTO ref_manual_referee(name, country_name, badge) VALUES (?, ?, ?)
     ON CONFLICT(name, country_name) DO NOTHING`,
  );
  const insRole = db.prepare(
    `INSERT INTO ref_staff_role(role, min_age, max_age, attributed, per_club)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(role) DO NOTHING`,
  );

  let leagues = 0;
  let names = 0;
  let bands = 0;
  let distributions = 0;
  let roles = 0;

  db.exec('BEGIN');
  try {
    for (const [id, country, name, level] of FC26_LEAGUES) {
      const promo = PROMOTION[level] ?? { promoted: 0, relegated: 0 };
      insLeague.run(id, country, name, level, promo.promoted, promo.relegated);
      leagues += 1;
    }

    for (const [country, pool] of Object.entries(STAFF_NAMES)) {
      for (const first of pool.first) {
        insName.run('staff', country, 'first', first);
        names += 1;
      }
      for (const last of pool.last) {
        insName.run('staff', country, 'last', last);
        names += 1;
      }
    }

    for (const [tier, attributes] of Object.entries(STAFF_BANDS)) {
      for (const [attribute, [min, max]] of Object.entries(attributes)) {
        insBand.run('staff', tier, attribute, min, max);
        bands += 1;
      }
    }

    for (const [style, weight] of STAFF_STYLES) {
      insDist.run('staff', 'style', style, weight);
      distributions += 1;
    }
    for (const [formation, weight] of STAFF_FORMATIONS) {
      insDist.run('staff', 'formation', formation, weight);
      distributions += 1;
    }

    for (const [role, minAge, maxAge, attributed, perClub] of STAFF_ROLES) {
      insRole.run(role, minAge, maxAge, attributed, perClub);
      roles += 1;
    }

    // --- HAKEM ve MENAJER referanslari
    //
    // Bunlar da once JSON dosyasindaydi (referee-pool.json / agent-pool.json).
    // Ayni gerekce: bir hakemin hangi kokart bandindan cekildigi dunyanin
    // kurulum verisidir ve veritabaninda yasar.
    for (const [country, first, last] of REFEREE_NAMES) {
      for (const v of first) { insName.run('referee', country, 'first', v); names += 1; }
      for (const v of last) { insName.run('referee', country, 'last', v); names += 1; }
    }
    for (const [country, first, last] of AGENT_NAMES) {
      for (const v of first) { insName.run('agent', country, 'first', v); names += 1; }
      for (const v of last) { insName.run('agent', country, 'last', v); names += 1; }
    }
    for (const [band, attribute, min, max] of REFEREE_BANDS) {
      insBand.run('referee', band, attribute, min, max);
      bands += 1;
    }
    for (const [band, attribute, min, max] of AGENT_BANDS) {
      insBand.run('agent', band, attribute, min, max);
      bands += 1;
    }
    for (const [badge, weight] of REFEREE_BADGES) {
      insDist.run('referee', 'badge', badge, weight);
      distributions += 1;
    }
    for (const [archetype, weight] of AGENT_ARCHETYPES) {
      insDist.run('agent', 'archetype', archetype, weight);
      distributions += 1;
    }
    for (const [entity, key, value] of SETTINGS) insSetting.run(entity, key, value);
    for (const m of MANUAL_REFEREES) insManual.run(m.name, m.country, m.badge);

    // --- MASKELEME REFERANSLARI
    for (const [kind, real, masked] of MASK_RULES) insRule.run(kind, real, masked);
    for (const [real, masked] of FC26_ALIASES) insRule.run('club', real, masked);
    for (const [bucket, values] of WORD_POOLS) {
      for (const v of values) insWord.run(bucket, v);
    }

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  log.info(
    'reference',
    `referans tohumu: ${leagues} lig, ${names} isim, ${bands} bant, ` +
      `${distributions} dagilim, ${roles} rol`,
  );

  return { leagues, names, bands, distributions, roles };
}

// --------------------------------------------------------------- okuma yardimcilari
//
// Hat ve motor referans verisini YALNIZCA bu fonksiyonlarla okur. Boylece
// "veri nereden geliyor" sorusunun tek bir cevabi olur: veritabani.

export interface LeagueRef {
  readonly sourceLeagueId: string;
  readonly countryName: string;
  readonly leagueName: string;
  readonly level: number;
  readonly promoted: number;
  readonly relegated: number;
}

export function readLeagues(db: DatabaseSyncType, sourceKind: string): Map<string, LeagueRef> {
  const rows = db
    .prepare(
      `SELECT source_league_id, country_name, league_name, level, promoted, relegated
       FROM ref_league WHERE source_kind = ?`,
    )
    .all(sourceKind) as unknown as {
    source_league_id: string;
    country_name: string;
    league_name: string;
    level: number;
    promoted: number;
    relegated: number;
  }[];

  return new Map(
    rows.map((r) => [
      r.source_league_id,
      {
        sourceLeagueId: r.source_league_id,
        countryName: r.country_name,
        leagueName: r.league_name,
        level: r.level,
        promoted: r.promoted,
        relegated: r.relegated,
      },
    ]),
  );
}

export interface NamePool {
  readonly first: readonly string[];
  readonly last: readonly string[];
}

/** Ulke havuzu; yoksa varsayilan (country_name = '') havuz. */
export function readNamePool(
  db: DatabaseSyncType,
  entityKind: string,
  countryName: string,
): NamePool {
  const load = (country: string): NamePool => {
    const rows = db
      .prepare(
        `SELECT part, value FROM ref_name_pool
         WHERE entity_kind = ? AND country_name = ? ORDER BY id`,
      )
      .all(entityKind, country) as unknown as { part: string; value: string }[];
    return {
      first: rows.filter((r) => r.part === 'first').map((r) => r.value),
      last: rows.filter((r) => r.part === 'last').map((r) => r.value),
    };
  };

  const own = load(countryName);
  if (own.first.length > 0 && own.last.length > 0) return own;
  return load('');
}

export type BandTable = ReadonlyMap<string, readonly [number, number]>;

export function readBands(
  db: DatabaseSyncType,
  entityKind: string,
  bandKey: string,
): BandTable {
  const rows = db
    .prepare(
      `SELECT attribute, min_value, max_value FROM ref_attribute_band
       WHERE entity_kind = ? AND band_key = ?`,
    )
    .all(entityKind, bandKey) as unknown as {
    attribute: string;
    min_value: number;
    max_value: number;
  }[];
  return new Map(rows.map((r) => [r.attribute, [r.min_value, r.max_value] as const]));
}

export function readDistribution(
  db: DatabaseSyncType,
  entityKind: string,
  bucket: string,
): ReadonlyMap<string, number> {
  const rows = db
    .prepare(
      `SELECT key, weight FROM ref_distribution WHERE entity_kind = ? AND bucket = ?`,
    )
    .all(entityKind, bucket) as unknown as { key: string; weight: number }[];
  return new Map(rows.map((r) => [r.key, r.weight]));
}

export interface StaffRoleRef {
  readonly role: string;
  readonly minAge: number;
  readonly maxAge: number;
  readonly attributed: boolean;
  readonly perClub: number;
}

export function readStaffRoles(db: DatabaseSyncType): readonly StaffRoleRef[] {
  const rows = db
    .prepare('SELECT role, min_age, max_age, attributed, per_club FROM ref_staff_role')
    .all() as unknown as {
    role: string;
    min_age: number;
    max_age: number;
    attributed: number;
    per_club: number;
  }[];
  return rows.map((r) => ({
    role: r.role,
    minAge: r.min_age,
    maxAge: r.max_age,
    attributed: r.attributed === 1,
    perClub: r.per_club,
  }));
}

/** Sayisal ayar okur. Satir yoksa verilen varsayilan doner. */
export function readSetting(
  db: DatabaseSyncType,
  entityKind: string,
  key: string,
  fallback: number,
): number {
  const row = db
    .prepare('SELECT value FROM ref_setting WHERE entity_kind = ? AND key = ?')
    .get(entityKind, key) as { value: number } | undefined;
  return row?.value ?? fallback;
}

export interface ManualReferee {
  readonly name: string;
  readonly countryName: string;
  readonly badge: string;
  readonly overrides: ReadonlyMap<string, number>;
}

/** Elle tanimli hakemler. Nitelik kolonu NULL ise bandtan cekilir. */
export function readManualReferees(db: DatabaseSyncType): readonly ManualReferee[] {
  const rows = db
    .prepare(
      `SELECT name, country_name, badge, strictness, card_tendency, penalty_courage,
              var_reliance, consistency, home_bias, experience, reputation
       FROM ref_manual_referee ORDER BY id`,
    )
    .all() as unknown as Record<string, string | number | null>[];

  return rows.map((r) => {
    const overrides = new Map<string, number>();
    for (const key of [
      'strictness', 'card_tendency', 'penalty_courage', 'var_reliance',
      'consistency', 'home_bias', 'experience', 'reputation',
    ]) {
      const v = r[key];
      if (typeof v === 'number') overrides.set(key, v);
    }
    return {
      name: String(r['name']),
      countryName: String(r['country_name']),
      badge: String(r['badge']),
      overrides,
    };
  });
}

/** Bir sozcuk havuzu -- 'club_distinctive' | 'place' | 'agency_suffix'. */
export function readWordPool(db: DatabaseSyncType, bucket: string): readonly string[] {
  const rows = db
    .prepare('SELECT value FROM ref_word_pool WHERE bucket = ? ORDER BY id')
    .all(bucket) as unknown as { value: string }[];
  return rows.map((r) => r.value);
}

/** Kuratorlu esleme tablosu: entity_kind -> (gercek ad -> maskeli ad). */
export function readMaskRules(
  db: DatabaseSyncType,
): ReadonlyMap<string, ReadonlyMap<string, string>> {
  const rows = db
    .prepare('SELECT entity_kind, name_real, name_masked FROM ref_mask_rule')
    .all() as unknown as { entity_kind: string; name_real: string; name_masked: string }[];

  const out = new Map<string, Map<string, string>>();
  for (const r of rows) {
    const bucket = out.get(r.entity_kind) ?? new Map<string, string>();
    bucket.set(r.name_real, r.name_masked);
    out.set(r.entity_kind, bucket);
  }
  return out;
}

/** Ulke sifatlarini country tablosuna yazar. Lig adlari bundan turer. */
export function applyCountryAdjectives(db: DatabaseSyncType): number {
  const update = db.prepare(
    "UPDATE country SET adjective = ? WHERE name_real = ? AND adjective = ''",
  );
  let n = 0;
  for (const [country, adjective] of COUNTRY_ADJECTIVES) {
    const r = update.run(adjective, country);
    n += Number(r.changes ?? 0);
  }
  return n;
}
