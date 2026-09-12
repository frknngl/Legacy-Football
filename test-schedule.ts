import { ContentLoader } from './src/loading/ContentLoader.js';
import { FileSystemContentSource } from './src/loading/FileSystemContentSource.js';
import { createSimulatedWorld } from './src/testing/simulatedWorld.js';

async function main() {
    const source = new FileSystemContentSource('content');
    const loader = new ContentLoader(source);
    const result = await loader.load();
    const registry = result.registry;
    if (!registry) {
        throw new Error("Failed to load registry");
    }
    
    const world = await createSimulatedWorld('content', registry, 100);
    const clubId = world.roster.clubs()[0].id;
    console.log("Club:", clubId, world.roster.club(clubId)?.league);
    
    let totalFixtures = 0;
    for (let week = 1; week <= 40; week++) {
        const fixtures = world.schedule.fixturesFor(clubId, week);
        totalFixtures += fixtures.length;
        if (fixtures.length > 0) {
            console.log(`Week ${week}: ${fixtures.length} fixtures`);
        }
    }
    console.log("Total fixtures in season:", totalFixtures);
}

main().catch(console.error);
