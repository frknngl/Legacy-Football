import { ContentLoader } from './src/loading/ContentLoader.js';
import { FileSystemContentSource } from './src/loading/FileSystemContentSource.js';
import { EligibilityFilter } from './src/selection/EligibilityFilter.js';
import { ERAS, STATURES, CLUB_TIERS, LIFE_STATES } from './src/domain/axes.js';

async function main() {
  const loader = new ContentLoader(new FileSystemContentSource('./content'));
  const content = await loader.load();
  const event = content.registry?.events.find(e => e.id === 'evt_locker_kavga_yardimci');
  const filter = new EligibilityFilter();
  
  let eligibleCount = 0;
  for (const era of ERAS) {
    for (const stature of STATURES) {
      for (const clubTier of CLUB_TIERS) {
        for (const lifeState of LIFE_STATES) {
          const ctx = {
            age: 25,
            era, stature, clubTier, lifeState,
            flags: {}, flagSetTurn: {}, turn: 150,
            mediaEra: 'era_social', archetype: 'arch_playmaker',
            seenEvents: new Set<string>(), seenVariants: new Set<string>(),
            storyArcTurns: {}, storyBeatTurns: {}, storyBeatCounts: {}, storySignatureTurns: {},
            cooldownState: { cooldowns: new Map(), familyCooldowns: new Map(), categoryCooldowns: new Map() },
            nemesis: undefined,
          } as any;
          
          if (filter.rejectReason(event!, ctx) === undefined) {
            eligibleCount++;
            console.log(`ELIGIBLE: era=${era} stature=${stature} clubTier=${clubTier} lifeState=${lifeState}`);
          }
        }
      }
    }
  }
  console.log('Total eligible combinations:', eligibleCount);
}

main().catch(console.error);
