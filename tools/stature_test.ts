import { readFileSync } from 'fs';
import { GameEngine } from '../src/runtime/GameEngine.js';
import { StatureCalculator } from '../src/evaluation/StatureCalculator.js';

const config = JSON.parse(readFileSync('content/orchestrator/progression.json', 'utf8'));
const calc = new StatureCalculator(config);

const flags = {
  taraftar_destegi: 80,
  medya_itibari: 80,
  piyasa_degeri: 50_000_000,
  kupa_sayisi: 10,
  milli_mac_sayisi: 80,
  sosyal_medya_takipci: 5_000_000,
  kariyer_mac_sayisi: 400,
  kariyer_gol_sayisi: 150,
  kariyer_asist_sayisi: 50
};

console.log('Score:', calc.score(flags));
console.log('Raw Level:', calc.rawLevel(calc.score(flags)));
