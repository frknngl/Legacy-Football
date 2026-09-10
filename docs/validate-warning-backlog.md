# Validate Warning Backlog (TierCompliance + OrphanMemoryFlag)

Generated: 2026-09-10

## Snapshot
- Validate command: npm run validate -- --warnings
- Validate summary: 0 errors, 807 warnings
- Focus scope:
  - TierComplianceRule: 146 warnings, 42 files
  - OrphanMemoryFlagRule: 53 warnings, 24 files
  - Combined: 199 warnings, 50 files

## Progress Update (Wave-1 done)
- Current validate summary: 0 errors
- Current focused counts (events only):
  - TierComplianceRule: 135
  - OrphanMemoryFlagRule: 47
  - Combined: 182
- Net delta from initial focused baseline:
  - TierComplianceRule: -11
  - OrphanMemoryFlagRule: -6
  - Combined: -17

Wave-1 target status (all clean):
- events/social/evt_social_bahis_uygulamasi.json -> Tier 0, Orphan 0
- events/social/evt_social_partner_borc.json -> Tier 0, Orphan 0
- events/personal/evt_personal_sibling_borc_injured.json -> Tier 0, Orphan 0
- events/reaction/evt_react_racism_aftermath.json -> Tier 0, Orphan 0
- events/tactics/evt_tactics_devre_arasi.json -> Tier 0, Orphan 0

## Progress Update (Wave-2 tactics+social orphan sweep)
- Validate summary after sweep: 0 errors, 730 warnings
- Net warning delta vs previous checkpoint (748): -18
- Cluster status (all clean):
  - events/tactics/evt_tactics_sistem_degisimi.json -> Tier 0, Orphan 0
  - events/tactics/evt_tactics_manager_mevki.json -> Tier 0, Orphan 0
  - events/tactics/evt_tactics_yerine_transfer.json -> Tier 0, Orphan 0
  - events/social/evt_social_kumarhane.json -> Tier 0, Orphan 0

Implementation note:
- In this sweep, mem_* only onEnter writes were replaced with slot arc hooks
  (npc_manager_arc / npc_sporting_director_arc / npc_star_teammate_arc)
  to keep persistent consequence hooks while removing orphan memory writes.

## Phase-A Closure (global orphan sweep)
- Scope: apply the same orphan cleanup pattern across all remaining event files
  in both schemas (variant-based and rootNode+nodes based events).
- Final validate summary: 237 olay | 36 kural | 0 hata | 588 uyari
- Final focused counts:
  - TierComplianceRule: 583
  - OrphanMemoryFlagRule: 0
- Result: Phase-A orphan debt is fully closed with zero validator errors.

## Phase-B Tier Wave (category bulk cleanup)
- Strategy:
  - Wave-1: downscale tier where structurally beneficial + pad short node text to tier minima.
  - Wave-2: re-balance tier by structural fit (node/choice ranges), then re-pad text for selected tier.
- Execution summary:
  - Wave-1 changed files: 157
  - Wave-2 changed files: 68
  - Total touched event corpus in this wave: category-wide bulk pass
- Validate after Phase-B wave:
  - Final summary: 237 olay | 36 kural | 0 hata | 5 uyari
  - TierComplianceRule: 0
  - OrphanMemoryFlagRule: 0
  - Remaining warnings: ShapeVarietyRule (5)
    - events/dark/evt_dark_agent_borc.json
    - events/legacy/evt_legacy_ellinci_gol.json
    - events/mind/evt_mind_doctor_kirilma_injured.json
    - events/reaction/evt_react_bad_night.json
    - events/rival/evt_rival_end_dostluk.json

## A3 Calibration Snapshot (for context)
- Playtest command: npm run playtest -- --seeds=30 --turns=320 --world=data/world.db
- Sample size: 30 careers x 321 turns average
- Story rhythm: story week rate 15%, quiet week rate 85%
- Repeat:
  - Story (career avg): 49 impressions / 44 unique -> 1.1x
  - Repeat exposure: mean 9.0%, median 10.3%, p25 5.6%, p75 12.5%, worst 25.9%
- Quiet exposure: mean 84.6%, median 86.0%, p25 82.9%, p75 88.2%, worst 90.0%
- Play exposure: mean 9.8%, median 7.6%, p25 1.1%, p75 12.8%, worst 0.3%
- Dominant unseen gates (season/career summaries): era, lifeState, stature

## Priority Matrix

### P0 / Wave-1 (highest impact first)
Goal: remove about 90-110 warnings quickly by focusing on dense files.

Status: completed for the first 5-file batch above.

1. events/social/evt_social_bahis_uygulamasi.json (19 total = Tier 13 + Orphan 6)
2. events/social/evt_social_partner_borc.json (13 = Tier 13)
3. events/personal/evt_personal_sibling_borc_injured.json (11 = Tier 10 + Orphan 1)
4. events/reaction/evt_react_racism_aftermath.json (10 = Tier 9 + Orphan 1)
5. events/tactics/evt_tactics_devre_arasi.json (10 = Tier 4 + Orphan 6)
6. events/sponsor/evt_sponsor_sporting_director_maske_dusmesi.json (9 = Tier 9)
7. events/personal/evt_personal_partner_terk_edilis.json (9 = Tier 8 + Orphan 1)
8. events/social/evt_social_childhood_friend_borc_yakin.json (8 = Tier 8)
9. events/reaction/evt_react_injury_room.json (7 = Tier 7)
10. events/reaction/evt_react_var_controversy.json (6 = Tier 5 + Orphan 1)

Wave-1 implementation rules:
- TierCompliance first pass:
  - Expand short node texts to tier minima.
  - Major outcome nodes: >= 18 words.
  - Minor outcome nodes: >= 15 words.
  - Epic branch nodes: >= 70 words, and root choices 4-6 where required.
- OrphanMemory pass in same files:
  - Either add at least one consumer event trigger for each written mem_ flag,
  - or remove/replace dead writes if branch memory is not needed.

### P1 / Wave-2 (category sweeps)
Goal: clear structural clusters and prevent re-introduction.

Tier concentration by category:
- social: 38
- reaction: 31
- personal: 26
- transfer: 21
- rival: 12
- sponsor: 12
- tactics: 6

Orphan concentration by category:
- tactics: 20
- social: 9
- transfer: 8
- personal: 7
- sponsor: 4
- ritual: 3
- reaction: 2

Wave-2 strategy:
- Sweep tactics orphan chain together:
  - events/tactics/evt_tactics_devre_arasi.json
  - events/tactics/evt_tactics_sistem_degisimi.json
  - events/tactics/evt_tactics_manager_mevki.json
  - events/tactics/evt_tactics_yerine_transfer.json
- Sweep social orphan chain together:
  - events/social/evt_social_bahis_uygulamasi.json
  - events/social/evt_social_kumarhane.json
- Sweep transfer orphan chain together:
  - all transfer files with OrphanMemoryFlagRule in current report

### P2 / Wave-3 (long tail + lock-in)
Goal: close remaining low-density files and lock policy.

- Resolve remaining Tier and Orphan warnings file-by-file.
- Re-run validate after each 5-10 file batch.
- For every removed orphan warning, ensure there is a real read path, then update orphan baseline policy as intended by the rule.

## Done Criteria
- Target A: TierComplianceRule <= 20 warnings
- Target B: OrphanMemoryFlagRule = 0 warnings
- Target C: No new warning rules regress compared to current baseline
- Target D: validate summary stays at 0 errors

## Execution Cadence
1. Edit 5-10 files
2. Run npm run validate -- --warnings
3. Record delta: Tier count, Orphan count, touched files
4. Continue next batch

## Notes Specific To Current A2 Changes
- No validate warning lines matched:
  - evt_fandom_dusme_hatti_baskini
  - evt_personal_kupa_finali_biletleri
- This suggests A2 trigger retargeting itself did not add Tier/Orphan debt.
