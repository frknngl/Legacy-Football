# Comprehensive QA Audit Report (100 Careers)

**Debug Rejections for evt_locker_kavga_yardimci:** undefined
**Failed LifeStates:** undefined

## RAPOR 1 — EXECUTIVE SUMMARY
- 100 Careers Simulated
- Total Unique Events Checked: 470
- Critical Issues Found: 4692
- Boundary Violations: 0

## RAPOR 2 & 3 — EVENT COVERAGE & DEAD/ORPHAN EVENTS
| Event ID | Shown | Eligible | Results Applied | Status |
|---|---:|---:|---:|---|
| evt_business_agent_borc | 6 | 51 | 6 | OK |
| evt_business_agent_kayip_retired | 23 | 131 | 23 | OK |
| evt_business_board_coup | 65 | 8640 | 46 | OK |
| evt_business_childhood_friend_kayip | 8 | 162 | 8 | OK |
| evt_business_club_sale | 55 | 8787 | 55 | OK |
| evt_business_ikinci_sozlesme_masasi | 0 | 0 | 0 | DEAD (Reason: {"era":5612,"lifeState":2197,"stature":814,"clubTier":989}) |
| evt_business_ilk_sozlesme_veli | 0 | 70 | 0 | RARE (Never Chosen) |
| evt_business_image_rights | 59 | 8727 | 59 | OK |
| evt_business_lawyer_ayartma_retired | 23 | 397 | 23 | OK |
| evt_business_lawyer_sinav | 16 | 178 | 16 | OK |
| evt_business_mail_yatirim | 0 | 0 | 0 | DEAD (Reason: {"era":5212,"stature":4326,"clubTier":74}) |
| evt_business_president_devir_teslim | 17 | 208 | 17 | OK |
| evt_business_president_dinner | 58 | 8742 | 57 | OK |
| evt_business_president_kayip_orta | 0 | 0 | 0 | DEAD (Reason: {"era":7190,"lifeState":1446,"clubTier":976}) |
| evt_business_president_sinav | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"lifeState":4649,"stature":1351}) |
| evt_business_salary_cut | 54 | 8802 | 43 | OK |
| evt_business_sporting_director_kirilma_yakin | 0 | 0 | 0 | DEAD (Reason: {"era":2790,"lifeState":4095,"clubTier":2727}) |
| evt_business_stadium_protest | 65 | 8642 | 62 | OK |
| evt_business_stadium_sponsor | 63 | 8667 | 61 | OK |
| evt_business_unpaid_wages | 61 | 8710 | 40 | OK |
| evt_dark_agent_borc | 4 | 135 | 4 | OK |
| evt_dark_agent_suc_ortakligi | 20 | 79 | 20 | OK |
| evt_dark_childhood_friend_ihanet | 2 | 71 | 2 | OK |
| evt_dark_childhood_friend_kirilma_transfer_listed | 52 | 2826 | 52 | OK |
| evt_dark_childhood_friend_yuzlesme | 4 | 90 | 4 | OK |
| evt_dark_fixer_ihanet | 5 | 57 | 5 | OK |
| evt_dark_fixer_kirilma_yakin | 10 | 7 | 10 | OK |
| evt_dark_fixer_suc_ortakligi | 5 | 127 | 5 | OK |
| evt_dark_kucuk_teklif_sari_kart | 0 | 0 | 0 | DEAD (Reason: {"era":8012,"lifeState":1204,"clubTier":360,"stature":36}) |
| evt_dark_lawyer_ayartma | 6 | 71 | 6 | OK |
| evt_dark_lawyer_borc | 26 | 1229 | 26 | OK |
| evt_dark_lawyer_kirilma | 7 | 96 | 7 | OK |
| evt_dark_lawyer_suc_ortakligi | 5 | 163 | 5 | OK |
| evt_dark_lawyer_yuzlesme | 5 | 201 | 5 | OK |
| evt_dark_prosecutor_kirilma | 15 | 41 | 15 | OK |
| evt_dark_santaj | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"stature":5926,"clubTier":74}) |
| evt_dark_sike_teklifi | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"clubTier":4075,"stature":1351,"lifeState":574}) |
| evt_dark_tefeci_kapida | 10 | 89 | 10 | OK |
| evt_fandom_cocuk_hayran | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"stature":5926,"clubTier":74}) |
| evt_fandom_dusme_hatti_baskini | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"lifeState":3836,"clubTier":1996,"stature":168}) |
| evt_fandom_fake_signature | 19 | 455 | 13 | OK |
| evt_fandom_fan_leader_maske_dusmesi | 6 | 193 | 6 | OK |
| evt_fandom_fan_leader_maske_dusmesi_suspended | 0 | 12 | 0 | RARE (Never Chosen) |
| evt_fandom_fan_leader_taninma | 0 | 7 | 0 | RARE (Never Chosen) |
| evt_fandom_fan_leader_zafer_bedeli | 6 | 102 | 6 | OK |
| evt_fandom_havaalani_karsilama | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"stature":5926,"clubTier":74}) |
| evt_fandom_holigan_tehdidi | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"stature":5926,"clubTier":74}) |
| evt_fandom_imza_gunu_tartismasi | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"stature":5926,"clubTier":74}) |
| evt_fandom_journalist_reddedilis | 2 | 6 | 2 | OK |
| evt_fandom_journalist_yuzlesme | 0 | 13 | 0 | RARE (Never Chosen) |
| evt_fandom_journalist_yuzlesme_suspended | 0 | 6 | 0 | RARE (Never Chosen) |
| evt_fandom_journalist_zafer_bedeli | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"lifeState":2997,"stature":1351,"clubTier":1652}) |
| evt_fandom_mangal | 35 | 2094 | 31 | OK |
| evt_fandom_pitch_invader_kid | 31 | 1155 | 31 | OK |
| evt_fandom_pundit_maske_dusmesi | 0 | 9 | 0 | RARE (Never Chosen) |
| evt_fandom_pundit_reddedilis_yakin | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"clubTier":3000,"lifeState":3000}) |
| evt_fandom_pundit_yuzlesme | 7 | 99 | 7 | OK |
| evt_fandom_pundit_zafer_bedeli_suspended | 0 | 8 | 0 | RARE (Never Chosen) |
| evt_fandom_sosyal_medya_linc | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"stature":5926,"clubTier":74}) |
| evt_fandom_tesis_basma | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"clubTier":4075,"stature":1351,"lifeState":574}) |
| evt_health_concussion | 78 | 8443 | 78 | OK |
| evt_health_dentist_issue | 99 | 8137 | 97 | OK |
| evt_health_dietary_supplement | 79 | 8440 | 72 | OK |
| evt_health_painkiller_addiction | 85 | 8353 | 85 | OK |
| evt_health_sleep_deprivation | 65 | 8650 | 65 | OK |
| evt_legacy_captain_armband | 58 | 8742 | 57 | OK |
| evt_legacy_documentary | 11 | 384 | 10 | OK |
| evt_legacy_documentary_veto | 67 | 8607 | 65 | OK |
| evt_legacy_ellinci_gol | 0 | 0 | 0 | DEAD (Reason: {"era":2790,"lifeState":6563,"trigger":238,"cooldown_family":20,"story_signature_gap":1}) |
| evt_legacy_forma_muzeye | 0 | 0 | 0 | DEAD (Reason: {"era":5190,"stature":4322,"lifeState":89,"trigger":11}) |
| evt_legacy_former_teammate_itiraf | 5 | 23 | 5 | OK |
| evt_legacy_icon_comparison | 10 | 937 | 10 | OK |
| evt_legacy_museum_donation | 65 | 8643 | 64 | OK |
| evt_legacy_number_retirement | 54 | 8814 | 54 | OK |
| evt_legacy_statue_promise | 59 | 8735 | 58 | OK |
| evt_legacy_testimonial_match | 65 | 8637 | 65 | OK |
| evt_legacy_ugly_statue | 0 | 0 | 0 | DEAD (Reason: {"era":9612}) |
| evt_legacy_yuzuncu_mac | 1 | 1 | 1 | OK |
| evt_dark_betting_offer | 10 | 80 | 10 | OK |
| evt_legal_betting_investigation | 5 | 9 | 5 | OK |
| evt_legal_contract_dispute | 73 | 8527 | 61 | OK |
| evt_legal_doping | 0 | 0 | 0 | DEAD (Reason: {"era":5212,"clubTier":3127,"stature":859,"lifeState":414}) |
| evt_legal_eski_dosya_sorusturma | 0 | 0 | 0 | DEAD (Reason: {"era":5190,"stature":1217,"lifeState":1660,"clubTier":1545}) |
| evt_legal_fixer_itiraf_orta | 10 | 19 | 10 | OK |
| evt_legal_fixer_itiraf_suspended | 1 | 0 | 1 | OK |
| evt_legal_fixer_yuzlesme_yakin | 1 | 16 | 1 | OK |
| evt_legal_journalist_itiraf_uzak | 0 | 0 | 0 | DEAD (Reason: {"era":2790,"clubTier":3405,"lifeState":3160,"cooldown_family":103,"trigger":154}) |
| evt_legal_mafia_collects | 2 | 3 | 2 | OK |
| evt_legal_match_fixing_rumor | 61 | 8697 | 60 | OK |
| evt_legal_pfdk_hearing | 1 | 0 | 1 | OK |
| evt_legal_red_card_defense | 73 | 8526 | 70 | OK |
| evt_legal_sponsorship_breach | 78 | 8461 | 78 | OK |
| evt_legal_stadium_ban | 67 | 8612 | 65 | OK |
| evt_legal_tax_audit | 83 | 8367 | 61 | OK |
| evt_legal_vergi | 0 | 0 | 0 | DEAD (Reason: {"era":5212,"stature":4326,"clubTier":74}) |
| evt_life_car_accident | 70 | 8567 | 70 | OK |
| evt_life_diet_cheat | 68 | 8592 | 68 | OK |
| evt_life_diyet_bozma | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"stature":5926,"clubTier":74}) |
| evt_life_family_leech | 77 | 8478 | 77 | OK |
| evt_life_gece_hayatindan_kacis | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"stature":5926,"clubTier":74}) |
| evt_life_gece_kulubu | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"clubTier":4075,"stature":1351,"lifeState":574}) |
| evt_life_gece_kulubu_ilk_paparazzi | 0 | 0 | 0 | DEAD (Reason: {"era":8012,"lifeState":1204,"clubTier":360,"stature":36}) |
| evt_life_haircut_disaster | 28 | 2679 | 21 | OK |
| evt_life_havalimani_pasaport_krizi | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"lifeState":3836,"clubTier":1996,"stature":168}) |
| evt_life_hazirlik_kampi_tartisi | 1 | 15 | 1 | OK |
| evt_life_hobi_meraki | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"stature":5926,"clubTier":74}) |
| evt_life_jubile_teklifi | 1 | 2 | 1 | OK |
| evt_life_komsularla_kavga | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"stature":5926,"clubTier":74}) |
| evt_life_mentor_geri_donus_rehab_clinic | 4 | 170 | 4 | OK |
| evt_life_mentor_itiraf_rehab_clinic | 2 | 162 | 2 | OK |
| evt_life_mentor_itiraf_transfer_listed | 5 | 207 | 5 | OK |
| evt_life_new_hobby | 72 | 8538 | 72 | OK |
| evt_life_night_out | 10 | 109 | 10 | OK |
| evt_life_pet_scandal | 64 | 8652 | 64 | OK |
| evt_life_prison_cell | 5 | 0 | 5 | OK |
| evt_life_prison_release | 3 | 6 | 3 | OK |
| evt_life_rehab_counselor_terk_edilis_rehab_clinic | 2 | 167 | 2 | OK |
| evt_life_rich_investor | 39 | 2269 | 24 | OK |
| evt_life_robbery_attempt | 71 | 8547 | 71 | OK |
| evt_life_secret_injury | 67 | 8632 | 67 | OK |
| evt_life_son_sezon_diz_karari | 0 | 0 | 0 | DEAD (Reason: {"era":7190,"lifeState":860,"stature":680,"clubTier":882}) |
| evt_life_soygun | 0 | 0 | 0 | DEAD (Reason: {"era":5212,"stature":4326,"clubTier":74}) |
| evt_life_stalker_fan | 71 | 8556 | 71 | OK |
| evt_life_suspended_stands | 1 | 14 | 1 | OK |
| evt_life_training_phone | 9 | 469 | 9 | OK |
| evt_life_wrong_tattoo | 15 | 1362 | 14 | OK |
| evt_life_youngster_devir_teslim_rehab_clinic | 2 | 123 | 2 | OK |
| evt_locker_assistant_devir_teslim | 0 | 0 | 0 | DEAD (Reason: {"era":5190,"stature":1217,"lifeState":1660,"clubTier":1545}) |
| evt_locker_captain_yuzlesme | 5 | 99 | 5 | OK |
| evt_locker_chat_isyan | 0 | 0 | 0 | DEAD (Reason: {"era":5212,"stature":4326,"clubTier":74}) |
| evt_locker_dj_fight | 21 | 946 | 21 | OK |
| evt_locker_forma_numarasi_kavgasi | 0 | 0 | 0 | DEAD (Reason: {"era":5212,"lifeState":2121,"stature":859,"clubTier":1420}) |
| evt_locker_genc_hadsizligi | 0 | 0 | 0 | DEAD (Reason: {"era":5212,"stature":4326,"clubTier":74}) |
| evt_locker_genc_oyuncu_dolabi | 0 | 0 | 0 | DEAD (Reason: {"era":5190,"stature":1217,"lifeState":1660,"clubTier":1545}) |
| evt_locker_hoca_gitti_hesap | 0 | 0 | 0 | DEAD (Reason: {"era":2790,"lifeState":6572,"trigger":250}) |
| evt_locker_hoca_isyani | 0 | 0 | 0 | DEAD (Reason: {"era":5212,"stature":4326,"clubTier":74}) |
| evt_locker_isyan_tohumu | 0 | 0 | 0 | DEAD (Reason: {"era":5212,"stature":4326,"lifeState":74}) |
| evt_locker_kaptanlik_kavgasi | 0 | 0 | 0 | DEAD (Reason: {"era":5212,"stature":4326,"clubTier":74}) |
| evt_locker_kavga_yardimci | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"clubTier":4075,"stature":1351,"lifeState":574}) |
| evt_locker_keeper_devir_teslim | 1 | 91 | 1 | OK |
| evt_locker_keeper_taninma | 4 | 9 | 4 | OK |
| evt_locker_manager_reddedilis | 7 | 52 | 7 | OK |
| evt_locker_prim_krizi | 0 | 0 | 0 | DEAD (Reason: {"era":5212,"stature":4326,"clubTier":74}) |
| evt_locker_rival_teammate_sadakat_sinavi | 5 | 195 | 5 | OK |
| evt_locker_son_dolap_bosaltma | 4 | 4 | 4 | OK |
| evt_locker_spy_tea_maker | 25 | 1009 | 24 | OK |
| evt_locker_star_teammate_golge | 4 | 47 | 4 | OK |
| evt_locker_star_teammate_isim | 1 | 42 | 1 | OK |
| evt_locker_stolen_watch | 21 | 1128 | 21 | OK |
| evt_locker_veteran_golge | 0 | 0 | 0 | DEAD (Reason: {"era":5212,"lifeState":2121,"stature":859,"clubTier":1420}) |
| evt_locker_veteran_ilk_gun | 6 | 119 | 6 | OK |
| evt_locker_veteran_yuzlesme | 1 | 4 | 1 | OK |
| evt_locker_yabanci_krizi | 0 | 0 | 0 | DEAD (Reason: {"era":5212,"stature":4326,"clubTier":74}) |
| evt_locker_yedek_kulubesi_gunlugu | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"lifeState":3836,"clubTier":1996,"stature":168}) |
| evt_locker_youngster_ayni_mevki | 7 | 168 | 7 | OK |
| evt_locker_youngster_reddedilis | 2 | 23 | 2 | OK |
| evt_match_captain_armband | 12 | 193 | 0 | ORPHAN (No State Applied) |
| evt_match_captaincy_struggle | 79 | 8433 | 79 | OK |
| evt_match_celebration | 33 | 420 | 0 | ORPHAN (No State Applied) |
| evt_match_corner_flag | 29 | 2635 | 23 | OK |
| evt_match_dive_opportunity | 18 | 404 | 0 | ORPHAN (No State Applied) |
| evt_match_eski_dost | 0 | 0 | 0 | DEAD (Reason: {"era":5212,"clubTier":3127,"stature":859,"lifeState":414}) |
| evt_match_free_kick | 54 | 386 | 0 | ORPHAN (No State Applied) |
| evt_match_freekick_fight | 30 | 1865 | 27 | OK |
| evt_match_ghost_goal | 12 | 180 | 0 | ORPHAN (No State Applied) |
| evt_match_hakem_saldirisi | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"stature":5926,"clubTier":74}) |
| evt_match_handball_on_line | 0 | 349 | 0 | RARE (Never Chosen) |
| evt_match_injury | 32 | 371 | 0 | ORPHAN (No State Applied) |
| evt_match_isinma_kavgasi | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"stature":5926,"clubTier":74}) |
| evt_match_kasitli_sakatlama | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"stature":5926,"clubTier":74}) |
| evt_match_kendi_kalesine | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"clubTier":5232,"lifeState":600,"stature":168}) |
| evt_match_last_minute | 36 | 224 | 0 | ORPHAN (No State Applied) |
| evt_match_last_minute_freekick | 73 | 8517 | 68 | OK |
| evt_match_manager_ejected | 79 | 8435 | 76 | OK |
| evt_match_missed_chance_boo | 77 | 8468 | 77 | OK |
| evt_match_object_thrown | 16 | 443 | 0 | ORPHAN (No State Applied) |
| evt_match_offside_marginal | 22 | 328 | 0 | ORPHAN (No State Applied) |
| evt_match_one_on_one | 22 | 256 | 0 | ORPHAN (No State Applied) |
| evt_match_penalti_krizi | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"stature":5926,"clubTier":74}) |
| evt_match_penalty_against | 0 | 475 | 0 | RARE (Never Chosen) |
| evt_match_penalty_for | 22 | 425 | 0 | ORPHAN (No State Applied) |
| evt_match_phantom_penalty | 90 | 8270 | 90 | OK |
| evt_match_pitch_invader | 77 | 8472 | 77 | OK |
| evt_match_racist_abuse | 20 | 202 | 0 | ORPHAN (No State Applied) |
| evt_match_red_card_provocation | 30 | 305 | 0 | ORPHAN (No State Applied) |
| evt_match_ref_dispute | 22 | 487 | 0 | ORPHAN (No State Applied) |
| evt_match_referee_shoelaces | 29 | 4396 | 28 | OK |
| evt_match_substituted_off | 32 | 498 | 0 | ORPHAN (No State Applied) |
| evt_match_teammate_feud | 22 | 441 | 0 | ORPHAN (No State Applied) |
| evt_match_var_against | 4 | 194 | 0 | ORPHAN (No State Applied) |
| evt_match_var_cancellation | 85 | 8359 | 84 | OK |
| evt_match_var_controversial | 12 | 340 | 0 | ORPHAN (No State Applied) |
| evt_match_var_review_for | 22 | 335 | 0 | ORPHAN (No State Applied) |
| evt_match_weather_disaster | 81 | 8418 | 80 | OK |
| evt_match_wrong_name | 17 | 1492 | 17 | OK |
| evt_match_wrong_shorts | 48 | 2774 | 47 | OK |
| evt_media_agent_devir_teslim_orta | 1 | 0 | 1 | OK |
| evt_media_agent_maske_dusmesi_injured | 1 | 5 | 1 | OK |
| evt_media_agent_yuzlesme_yakin | 0 | 0 | 0 | DEAD (Reason: {"era":2790,"stature":6722,"lifeState":89,"trigger":11}) |
| evt_media_basinda_sizar | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"stature":5926,"clubTier":74}) |
| evt_media_canli_yayin_gafi | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"stature":5926,"clubTier":74}) |
| evt_media_charity_gala | 69 | 8597 | 69 | OK |
| evt_media_deepfake | 10 | 400 | 10 | OK |
| evt_media_derbi_oncesi_kiskirtma | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"stature":5926,"clubTier":74}) |
| evt_media_document_leak | 53 | 8820 | 53 | OK |
| evt_media_documentary_crew | 68 | 8597 | 68 | OK |
| evt_media_era_deepfake | 10 | 16 | 10 | OK |
| evt_media_era_instagram | 10 | 13 | 10 | OK |
| evt_media_era_tiktok | 10 | 16 | 10 | OK |
| evt_media_era_twitter | 10 | 16 | 10 | OK |
| evt_media_fake_language | 18 | 1227 | 18 | OK |
| evt_media_fake_news | 67 | 8607 | 66 | OK |
| evt_media_ilk_roportaj | 2 | 41 | 2 | OK |
| evt_media_isyanci_etiketi | 0 | 0 | 0 | DEAD (Reason: {"era":5190,"trigger":4422}) |
| evt_media_journalist_golge_orta | 0 | 0 | 0 | DEAD (Reason: {"era":7190,"clubTier":1205,"lifeState":691,"trigger":526}) |
| evt_media_journalist_itiraf_orta | 0 | 0 | 0 | DEAD (Reason: {"era":5190,"stature":1217,"clubTier":1219,"lifeState":1986}) |
| evt_media_journalist_taninma | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"clubTier":3000,"lifeState":3000}) |
| evt_media_journalist_taninma_injured | 0 | 0 | 0 | DEAD (Reason: {"era":5190,"lifeState":4422}) |
| evt_media_kotu_performans_manseti | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"stature":5926,"clubTier":74}) |
| evt_media_leak_transfer | 72 | 8537 | 72 | OK |
| evt_media_leaked_audio | 54 | 8815 | 54 | OK |
| evt_media_live_gaffe | 61 | 8708 | 61 | OK |
| evt_media_magazine_cover | 71 | 8551 | 71 | OK |
| evt_media_oyun_reyting_isyani | 3 | 115 | 3 | OK |
| evt_media_paparazzi_chase | 74 | 8514 | 74 | OK |
| evt_media_physio_borc_orta | 0 | 0 | 0 | DEAD (Reason: {"era":7190,"stature":2422}) |
| evt_media_podcast_invite | 62 | 8686 | 62 | OK |
| evt_media_pundit_taninma_injured | 1 | 1 | 1 | OK |
| evt_media_pundit_yuzlesme_injured | 0 | 12 | 0 | RARE (Never Chosen) |
| evt_media_pundit_yuzlesme_yakin | 0 | 0 | 0 | DEAD (Reason: {"clubTier":2715,"era":4422,"lifeState":2460,"trigger":15}) |
| evt_media_roportaj_terk_etme | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"stature":5926,"clubTier":74}) |
| evt_media_son_roportaj_pismanlik | 1 | 6 | 1 | OK |
| evt_media_talk_show | 69 | 8587 | 69 | OK |
| evt_media_tweet_skandal | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"stature":5926,"clubTier":74}) |
| evt_media_veteran_kayip_orta | 0 | 0 | 0 | DEAD (Reason: {"era":7190,"clubTier":1205,"lifeState":1217}) |
| evt_media_yalan_haber | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"stature":5926,"clubTier":74}) |
| evt_mental_burnout_symptoms | 94 | 8217 | 94 | OK |
| evt_mental_homesickness | 85 | 8340 | 85 | OK |
| evt_mental_imposter_syndrome | 84 | 8361 | 84 | OK |
| evt_mental_social_media_hate | 80 | 8417 | 80 | OK |
| evt_mental_yips | 86 | 8339 | 86 | OK |
| evt_mind_alien_sighting | 28 | 2779 | 28 | OK |
| evt_mind_cursed_boots | 28 | 2633 | 28 | OK |
| evt_mind_doctor_kirilma_injured | 1 | 1 | 1 | OK |
| evt_mind_doctor_maske_dusmesi | 0 | 0 | 0 | DEAD (Reason: {"era":2790,"lifeState":2981,"stature":1539,"clubTier":2302}) |
| evt_mind_doctor_olcum | 2 | 32 | 2 | OK |
| evt_mind_fire_alarm | 18 | 989 | 17 | OK |
| evt_mind_hedefsizlik | 0 | 0 | 0 | DEAD (Reason: {"era":5212,"stature":4400}) |
| evt_mind_medya_takintisi | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"stature":5926,"clubTier":74}) |
| evt_mind_medyum | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"clubTier":4075,"stature":1351,"lifeState":574}) |
| evt_mind_mentor_itiraf | 4 | 73 | 4 | OK |
| evt_mind_mentor_maske_dusmesi_injured | 0 | 1 | 0 | RARE (Never Chosen) |
| evt_mind_nostalji_krizi | 0 | 0 | 0 | DEAD (Reason: {"era":5212,"stature":4326,"clubTier":74}) |
| evt_mind_oynamama_korkusu | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"stature":5926,"clubTier":74}) |
| evt_mind_partner_ayartma | 3 | 29 | 3 | OK |
| evt_mind_partner_itiraf | 5 | 86 | 5 | OK |
| evt_mind_partner_kirilma | 3 | 106 | 3 | OK |
| evt_mind_physio_ayartma | 3 | 52 | 3 | OK |
| evt_mind_physio_itiraf_injured | 0 | 0 | 0 | DEAD (Reason: {"era":5212,"lifeState":4317,"stature":74,"cooldown_family":6,"story_arc_gap":3}) |
| evt_mind_physio_kirilma | 0 | 0 | 0 | DEAD (Reason: {"era":5212,"lifeState":2121,"stature":859,"clubTier":1420}) |
| evt_mind_psychologist_ayartma_injured | 0 | 0 | 0 | DEAD (Reason: {"era":5190,"lifeState":4322,"stature":100}) |
| evt_mind_psychologist_kirilma | 3 | 21 | 3 | OK |
| evt_mind_psychologist_sinav | 2 | 71 | 2 | OK |
| evt_mind_rehab_kacamak | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"clubTier":4075,"stature":1351,"lifeState":574}) |
| evt_mind_tukenmislik | 0 | 0 | 0 | DEAD (Reason: {"era":5212,"stature":4326,"clubTier":74}) |
| evt_mind_uyku_problemi | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"stature":5926,"clubTier":74}) |
| evt_money_agent_borc | 2 | 97 | 2 | OK |
| evt_money_agent_zafer_bedeli | 0 | 0 | 0 | DEAD (Reason: {"era":2790,"lifeState":4095,"clubTier":2727}) |
| evt_money_betting_addiction | 70 | 8574 | 68 | OK |
| evt_money_borsa_tuyosu | 0 | 0 | 0 | DEAD (Reason: {"era":5212,"stature":4326,"clubTier":74}) |
| evt_money_borsa_yatirimi | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"lifeState":2323,"stature":1351,"clubTier":2326}) |
| evt_money_charity_scam | 82 | 8382 | 82 | OK |
| evt_money_crypto_bros | 21 | 1424 | 11 | OK |
| evt_money_crypto_scam | 75 | 8501 | 39 | OK |
| evt_money_divorce_settlement | 71 | 8555 | 71 | OK |
| evt_money_esports | 13 | 336 | 7 | OK |
| evt_money_fashion_brand | 81 | 8423 | 81 | OK |
| evt_money_ilk_maas | 2 | 60 | 2 | OK |
| evt_money_ilk_maas_kredisi | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"stature":5926,"clubTier":74}) |
| evt_money_kripto_vurgunu | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"stature":5926,"clubTier":74}) |
| evt_money_lawyer_sinav | 1 | 228 | 1 | OK |
| evt_money_lawyer_zafer_bedeli | 5 | 123 | 5 | OK |
| evt_money_luxury_purchase | 77 | 8473 | 77 | OK |
| evt_money_pink_car | 19 | 1158 | 18 | OK |
| evt_money_president_borc | 9 | 271 | 9 | OK |
| evt_money_president_sinav | 4 | 127 | 4 | OK |
| evt_money_sporting_director_ayartma | 6 | 102 | 6 | OK |
| evt_money_sporting_director_zafer_bedeli_retired | 16 | 271 | 16 | OK |
| evt_money_team_dinner | 24 | 1904 | 13 | OK |
| evt_national_camp_kavga | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"stature":5926,"clubTier":74}) |
| evt_national_flight_home | 16 | 303 | 14 | OK |
| evt_national_formayi_degisme | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"stature":5926,"clubTier":74}) |
| evt_national_ilk_11_krizi | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"stature":5926,"clubTier":74}) |
| evt_national_ilk_forma | 2 | 21 | 2 | OK |
| evt_national_kadro_disi | 4 | 7 | 4 | OK |
| evt_national_kampa_gec_katilma | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"stature":5926,"clubTier":74}) |
| evt_national_kaptanlik_pazubandi | 0 | 0 | 0 | DEAD (Reason: {"era":5212,"stature":4326,"clubTier":74}) |
| evt_national_national_captain_sadakat_sinavi | 0 | 0 | 0 | DEAD (Reason: {"stature":2790,"era":6822}) |
| evt_national_rival_roommate | 20 | 763 | 20 | OK |
| evt_national_sakken_oynama | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"stature":5926,"clubTier":74}) |
| evt_national_star_teammate_reddedilis | 1 | 3 | 1 | OK |
| evt_national_star_teammate_sadakat_sinavi | 0 | 1 | 0 | RARE (Never Chosen) |
| evt_national_turnuva_elenişi | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"stature":5926,"clubTier":74}) |
| evt_national_umit_milli_sinav | 5 | 109 | 5 | OK |
| evt_national_veda | 1 | 2 | 1 | OK |
| evt_personal_araba_kazasi | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"stature":5926,"clubTier":74}) |
| evt_personal_borcun_golgesi | 60 | 682 | 60 | OK |
| evt_personal_child_geri_donus_yakin | 2 | 27 | 2 | OK |
| evt_personal_childhood_friend_borc | 10 | 107 | 10 | OK |
| evt_personal_childhood_friend_kayip_injured | 0 | 18 | 0 | RARE (Never Chosen) |
| evt_personal_childhood_friend_terk_edilis_retired | 16 | 894 | 16 | OK |
| evt_personal_cocuk | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"clubTier":4075,"stature":1351,"lifeState":574}) |
| evt_personal_cousin_borc_retired | 10 | 1 | 10 | OK |
| evt_personal_cousin_ikinci_istek | 0 | 0 | 0 | DEAD (Reason: {"era":5212,"stature":4326,"lifeState":17,"clubTier":57}) |
| evt_personal_cousin_istek | 2 | 50 | 2 | OK |
| evt_personal_cousin_sadakat_sinavi | 0 | 0 | 0 | DEAD (Reason: {"era":2790,"lifeState":2981,"stature":1539,"clubTier":2302}) |
| evt_personal_cousin_terk_edilis | 1 | 7 | 1 | OK |
| evt_personal_eski_sevgili_ifsa | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"stature":5926,"clubTier":74}) |
| evt_personal_evlilik | 0 | 0 | 0 | DEAD (Reason: {"era":5612,"clubTier":2786,"stature":814,"lifeState":400}) |
| evt_personal_father_geri_donus_orta | 0 | 0 | 0 | DEAD (Reason: {"era":7190,"stature":2422}) |
| evt_personal_father_kayip | 2 | 278 | 2 | OK |
| evt_personal_father_terk_edilis_injured | 0 | 3 | 0 | RARE (Never Chosen) |
| evt_personal_gece_kulubu_skandali | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"stature":5926,"clubTier":74}) |
| evt_personal_kavga_sokak | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"stature":5926,"clubTier":74}) |
| evt_personal_kumar_borcu | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"stature":5926,"clubTier":74}) |
| evt_personal_kupa_finali_biletleri | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"lifeState":3836,"clubTier":1996,"stature":168}) |
| evt_personal_mother_itiraf | 6 | 262 | 6 | OK |
| evt_personal_partner_geri_donus_injured | 0 | 0 | 0 | DEAD (Reason: {"era":5190,"lifeState":4422}) |
| evt_personal_partner_geri_donus_transfer_listed | 20 | 35 | 20 | OK |
| evt_personal_partner_terk_edilis | 3 | 45 | 3 | OK |
| evt_personal_sibling_borc_injured | 0 | 12 | 0 | RARE (Never Chosen) |
| evt_personal_sibling_geri_donus | 0 | 0 | 0 | DEAD (Reason: {"era":5212,"lifeState":2121,"stature":859,"clubTier":1420}) |
| evt_react_bad_night | 17 | 14 | 24 | OK |
| evt_react_discipline_fallout | 20 | 6 | 21 | OK |
| evt_react_hero_night | 22 | 29 | 22 | OK |
| evt_react_injury_room | 16 | 5 | 16 | OK |
| evt_react_locker_room_court | 16 | 13 | 16 | OK |
| evt_react_penalty_missed | 2 | 1 | 2 | OK |
| evt_react_racism_aftermath | 7 | 0 | 7 | OK |
| evt_react_var_controversy | 2 | 1 | 2 | OK |
| evt_reaction_bench_tantrum | 76 | 8489 | 76 | OK |
| evt_reaction_captain_scolding | 68 | 8592 | 67 | OK |
| evt_reaction_derby_provocation | 86 | 8334 | 86 | OK |
| evt_reaction_fan_backlash | 77 | 8459 | 77 | OK |
| evt_reaction_late_for_match | 85 | 8338 | 85 | OK |
| evt_reaction_manager_criticism | 77 | 8492 | 53 | OK |
| evt_reaction_racial_abuse | 87 | 8319 | 86 | OK |
| evt_reaction_social_media_hack | 88 | 8306 | 86 | OK |
| evt_reaction_teammate_injury | 79 | 8440 | 76 | OK |
| evt_ritual_armband | 19 | 361 | 18 | OK |
| evt_ritual_batil_inanc | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"clubTier":4075,"stature":1351,"lifeState":574}) |
| evt_ritual_keeper_corap | 8 | 473 | 8 | OK |
| evt_ritual_otobus_koltugu_savasi | 0 | 0 | 0 | DEAD (Reason: {"era":5190,"stature":1217,"lifeState":1660,"clubTier":1545}) |
| evt_ritual_pop_song | 50 | 2514 | 50 | OK |
| evt_ritual_ugurlu_esya | 48 | 2824 | 44 | OK |
| evt_ritual_veteran_golge | 2 | 53 | 3 | OK |
| evt_ritual_veteran_sadakat_sinavi | 0 | 0 | 0 | DEAD (Reason: {"era":2790,"stature":6722,"lifeState":100}) |
| evt_ritual_yenilmezlik_serisi | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"lifeState":3836,"clubTier":1996,"stature":168}) |
| evt_ritual_youngster_taninma | 0 | 0 | 0 | DEAD (Reason: {"era":5612,"stature":4000}) |
| evt_rival_end_dostluk | 5 | 8695 | 5 | OK |
| evt_rival_end_saygi | 3 | 8885 | 3 | OK |
| evt_rival_end_yikim | 2 | 9054 | 2 | OK |
| evt_rival_ex_club_welcome | 78 | 8442 | 76 | OK |
| evt_rival_final_match | 10 | 695 | 10 | OK |
| evt_rival_first_derby | 10 | 500 | 10 | OK |
| evt_rival_first_sighting | 10 | 130 | 10 | OK |
| evt_rival_forma_degisimi_tuneli | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"lifeState":2323,"stature":1351,"clubTier":2326}) |
| evt_rival_injury_moment | 10 | 3060 | 10 | OK |
| evt_rival_injury_revenge | 84 | 8360 | 83 | OK |
| evt_rival_kutlama_hirsizi | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"stature":5926,"clubTier":74}) |
| evt_rival_last_call | 10 | 5360 | 10 | OK |
| evt_rival_manager_beef | 83 | 8378 | 82 | OK |
| evt_rival_national_bench | 10 | 2560 | 10 | OK |
| evt_rival_post_match_handshake | 78 | 8452 | 78 | OK |
| evt_rival_press_jab | 10 | 1006 | 10 | OK |
| evt_rival_private_dinner | 10 | 3567 | 10 | OK |
| evt_rival_same_agent | 8 | 2580 | 8 | OK |
| evt_rival_social_taunt | 87 | 8314 | 87 | OK |
| evt_rival_transfer_race | 10 | 1919 | 10 | OK |
| evt_rival_tunnel_brawl | 67 | 8620 | 67 | OK |
| evt_social_bagis_gecesi_skandali | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"stature":5926,"clubTier":74}) |
| evt_social_bahis_uygulamasi | 10 | 127 | 10 | OK |
| evt_social_charity_scandal | 65 | 8663 | 65 | OK |
| evt_social_childhood_friend_borc_yakin | 0 | 0 | 0 | DEAD (Reason: {"lifeState":4046,"stature":1135,"era":4422,"trigger":9}) |
| evt_social_concert_leak | 22 | 1093 | 22 | OK |
| evt_social_dog_jersey | 31 | 2521 | 29 | OK |
| evt_social_eski_dost_ziyareti | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"stature":5926,"clubTier":74}) |
| evt_social_ev_partisi | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"lifeState":2997,"stature":1351,"clubTier":1652}) |
| evt_social_fixer_ayartma | 0 | 9 | 0 | RARE (Never Chosen) |
| evt_social_gamer_stream | 68 | 8592 | 68 | OK |
| evt_social_gizli_iliski | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"stature":5926,"clubTier":74}) |
| evt_social_hesap_calinmasi | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"stature":5926,"clubTier":74}) |
| evt_social_hometown_visit | 80 | 8412 | 80 | OK |
| evt_social_isim_hatasi_devam | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"stature":5926,"clubTier":74}) |
| evt_social_kumarhane | 4 | 33 | 4 | OK |
| evt_social_leaked_training | 21 | 1491 | 21 | OK |
| evt_social_mars_krizi | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"stature":5926,"clubTier":74}) |
| evt_social_partner_borc | 6 | 80 | 6 | OK |
| evt_social_partner_yuzlesme_orta | 0 | 0 | 0 | DEAD (Reason: {"era":5190,"stature":4422}) |
| evt_social_political_comment | 75 | 8493 | 75 | OK |
| evt_social_president_wedding | 17 | 1494 | 17 | OK |
| evt_social_sms_eskidost | 0 | 0 | 0 | DEAD (Reason: {"era":5612,"stature":4000}) |
| evt_social_star_teammate_kirilma | 10 | 157 | 10 | OK |
| evt_social_takim_yemegi_terk | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"stature":5926,"clubTier":74}) |
| evt_social_twitch_gaf | 17 | 1320 | 17 | OK |
| evt_social_unlu_partisi | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"stature":5926,"clubTier":74}) |
| evt_social_vip_brawl | 64 | 8675 | 64 | OK |
| evt_social_voice_tehdit | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"stature":5926,"clubTier":74}) |
| evt_social_wedding_crash | 67 | 8607 | 67 | OK |
| evt_social_yacht_rival | 16 | 631 | 15 | OK |
| evt_sponsor_absurt_reklam | 29 | 1189 | 28 | OK |
| evt_sponsor_agent_reddedilis | 0 | 0 | 0 | DEAD (Reason: {"stature":2790,"era":6822}) |
| evt_sponsor_fotograf | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"stature":5926,"clubTier":74}) |
| evt_sponsor_fotograf_cekimi | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"stature":5926,"clubTier":74}) |
| evt_sponsor_ilk_krampon_catismasi | 0 | 0 | 0 | DEAD (Reason: {"era":8012,"lifeState":1204,"clubTier":360,"stature":36}) |
| evt_sponsor_krizi | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"stature":5926,"clubTier":74}) |
| evt_sponsor_mail_kriz | 0 | 0 | 0 | DEAD (Reason: {"era":5212,"stature":4326,"clubTier":74}) |
| evt_sponsor_movie_cameo | 37 | 2863 | 37 | OK |
| evt_sponsor_rakip_marka | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"stature":5926,"clubTier":74}) |
| evt_sponsor_reklam_cekimi | 5 | 85 | 5 | OK |
| evt_sponsor_rival_brand | 17 | 539 | 17 | OK |
| evt_sponsor_sosyal_sorumluluk | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"stature":5926,"clubTier":74}) |
| evt_sponsor_sporting_director_maske_dusmesi | 2 | 6 | 2 | OK |
| evt_sponsor_sporting_director_reddedilis | 0 | 0 | 0 | DEAD (Reason: {"era":2790,"stature":6722,"lifeState":100}) |
| evt_sponsor_sporting_director_sinav | 0 | 0 | 0 | DEAD (Reason: {"era":5190,"stature":4322,"lifeState":100}) |
| evt_sponsor_ugly_kit | 21 | 1183 | 21 | OK |
| evt_sponsor_yeni_koleksiyon | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"stature":5926,"clubTier":74}) |
| evt_tactics_board_clash | 22 | 851 | 19 | OK |
| evt_tactics_devre_arasi | 12 | 247 | 12 | OK |
| evt_tactics_false_nine | 76 | 8472 | 74 | OK |
| evt_tactics_gol_orucu | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"lifeState":3836,"clubTier":1996,"stature":168}) |
| evt_tactics_hakem_kokart_hafizasi | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"lifeState":3836,"clubTier":1996,"stature":168}) |
| evt_tactics_krampon_krizi | 22 | 3039 | 22 | OK |
| evt_tactics_language_barrier | 16 | 887 | 14 | OK |
| evt_tactics_manager_mevki | 7 | 70 | 7 | OK |
| evt_tactics_player_manager | 10 | 19 | 4 | OK |
| evt_tactics_position_change | 63 | 8680 | 43 | OK |
| evt_tactics_rebellion | 88 | 8298 | 88 | OK |
| evt_tactics_rival_teammate_taninma | 0 | 9 | 0 | RARE (Never Chosen) |
| evt_tactics_setpiece_thief | 25 | 1740 | 24 | OK |
| evt_tactics_sistem_degisikligi | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"clubTier":4075,"stature":1351,"lifeState":574}) |
| evt_tactics_sistem_degisimi | 4 | 34 | 4 | OK |
| evt_tactics_tikitaka_obsession | 20 | 1325 | 20 | OK |
| evt_tactics_translator_error | 71 | 8548 | 70 | OK |
| evt_tactics_video_analysis | 76 | 8478 | 68 | OK |
| evt_tactics_yerine_transfer | 4 | 69 | 4 | OK |
| evt_training_extra_shift | 83 | 8371 | 78 | OK |
| evt_training_late_arrival | 88 | 8303 | 82 | OK |
| evt_training_new_drill | 93 | 8247 | 80 | OK |
| evt_training_pitch_fight | 84 | 8366 | 83 | OK |
| evt_training_youth_prospect | 93 | 8222 | 93 | OK |
| evt_transfer_agent_feud | 74 | 8508 | 74 | OK |
| evt_transfer_agent_sadakat_sinavi | 6 | 30 | 6 | OK |
| evt_transfer_agent_wars | 16 | 1303 | 16 | OK |
| evt_transfer_captain_ayartma_transfer_listed | 38 | 1702 | 38 | OK |
| evt_transfer_captain_geri_donus | 20 | 1312 | 20 | OK |
| evt_transfer_chat_dedikodu | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"stature":5926,"clubTier":74}) |
| evt_transfer_forced_move | 61 | 8697 | 61 | OK |
| evt_transfer_free_agent | 66 | 8645 | 66 | OK |
| evt_transfer_hijack | 72 | 8542 | 72 | OK |
| evt_transfer_president_ayartma | 59 | 667 | 59 | OK |
| evt_transfer_rakibe_gecis_hesaplasma | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"lifeState":2323,"stature":1351,"clubTier":2326}) |
| evt_transfer_rival_club_manager_geri_donus | 1 | 1 | 1 | OK |
| evt_transfer_rival_club_manager_terk_edilis | 38 | 351 | 38 | OK |
| evt_transfer_rival_club_manager_yuzlesme_yakin | 0 | 0 | 0 | DEAD (Reason: {"era":5190,"clubTier":2205,"lifeState":2210,"trigger":7}) |
| evt_transfer_rumor_mill | 76 | 8472 | 59 | OK |
| evt_transfer_secret_clause | 71 | 8547 | 65 | OK |
| evt_transfer_sporting_director_reddedilis | 0 | 0 | 0 | DEAD (Reason: {"era":3612,"lifeState":2997,"stature":1351,"clubTier":1652}) |
| evt_transfer_sporting_director_sadakat_sinavi | 10 | 724 | 10 | OK |
| evt_transfer_squad_number | 17 | 1393 | 17 | OK |

## RAPOR 4 & 5 — STATISTICS & POSITION SANITY
| Position | Avg Matches | Avg Goals | Avg Assists |
|---|---:|---:|---:|
| MF | 30.1 | 4.1 | 3.0 |
| FW | 24.7 | 9.0 | 1.0 |

## RAPOR 10 — IMPOSSIBLE STATES & TEMPORAL CONSISTENCY
### Impossible States
None detected.
### Temporal Issues
- 🔴 CRITICAL: Career 2000: MATCH WITH 0 MINUTES! avBefore.available: false, lifeState: transfer_listed. Turn 14
- 🔴 CRITICAL: Career 2000: MATCH WITH 0 MINUTES! avBefore.available: false, lifeState: transfer_listed. Turn 15
- 🔴 CRITICAL: Career 2000: MATCH WITH 0 MINUTES! avBefore.available: false, lifeState: transfer_listed. Turn 18
- 🔴 CRITICAL: Career 2000: MATCH WITH 0 MINUTES! avBefore.available: false, lifeState: transfer_listed. Turn 19
- 🔴 CRITICAL: Career 2000: MATCH WITH 0 MINUTES! avBefore.available: false, lifeState: transfer_listed. Turn 21
- 🔴 CRITICAL: Career 2000: MATCH WITH 0 MINUTES! avBefore.available: false, lifeState: transfer_listed. Turn 22
- 🔴 CRITICAL: Career 2000: MATCH WITH 0 MINUTES! avBefore.available: false, lifeState: transfer_listed. Turn 24
- 🔴 CRITICAL: Career 2000: MATCH WITH 0 MINUTES! avBefore.available: false, lifeState: transfer_listed. Turn 25
- 🔴 CRITICAL: Career 2000: MATCH WITH 0 MINUTES! avBefore.available: false, lifeState: transfer_listed. Turn 28
- 🔴 CRITICAL: Career 2000: MATCH WITH 0 MINUTES! avBefore.available: false, lifeState: transfer_listed. Turn 29
- 🔴 CRITICAL: Career 2000: MATCH WITH 0 MINUTES! avBefore.available: false, lifeState: transfer_listed. Turn 31
- 🔴 CRITICAL: Career 2000: MATCH WITH 0 MINUTES! avBefore.available: false, lifeState: transfer_listed. Turn 32
- 🔴 CRITICAL: Career 2000: MATCH WITH 0 MINUTES! avBefore.available: false, lifeState: transfer_listed. Turn 35
- 🔴 CRITICAL: Career 2000: MATCH WITH 0 MINUTES! avBefore.available: false, lifeState: transfer_listed. Turn 36
- 🔴 CRITICAL: Career 2000: MATCH WITH 0 MINUTES! avBefore.available: false, lifeState: transfer_listed. Turn 38
- 🔴 CRITICAL: Career 2000: MATCH WITH 0 MINUTES! avBefore.available: false, lifeState: transfer_listed. Turn 41
- 🔴 CRITICAL: Career 2000: MATCH WITH 0 MINUTES! avBefore.available: false, lifeState: transfer_listed. Turn 43
- 🔴 CRITICAL: Career 2000: MATCH WITH 0 MINUTES! avBefore.available: false, lifeState: transfer_listed. Turn 44
- 🔴 CRITICAL: Career 2000: MATCH WITH 0 MINUTES! avBefore.available: false, lifeState: transfer_listed. Turn 47
- 🔴 CRITICAL: Career 2000: MATCH WITH 0 MINUTES! avBefore.available: false, lifeState: transfer_listed. Turn 48
### State Boundary Violations
None detected.

## RAPOR 13 — OUTLIER CAREERS
### Career 2000 (MF)
- Reason: Consistency Issues
- Stats: 6M, 0G, 2A
- Total Turns: 1001
### Career 2001 (MF)
- Reason: Consistency Issues
- Stats: 24M, 4G, 2A
- Total Turns: 961
### Career 2002 (MF)
- Reason: Consistency Issues
- Stats: 10M, 1G, 1A
- Total Turns: 893
### Career 2003 (FW)
- Reason: Consistency Issues
- Stats: 11M, 6G, 1A
- Total Turns: 961
### Career 2004 (FW)
- Reason: Consistency Issues
- Stats: 60M, 20G, 2A
- Total Turns: 1001
### Career 2005 (MF)
- Reason: Consistency Issues
- Stats: 22M, 2G, 2A
- Total Turns: 1001
### Career 2006 (MF)
- Reason: Consistency Issues
- Stats: 2M, 0G, 0A
- Total Turns: 1001
### Career 2007 (MF)
- Reason: Consistency Issues
- Stats: 38M, 9G, 8A
- Total Turns: 961
### Career 2008 (MF)
- Reason: Consistency Issues
- Stats: 109M, 13G, 6A
- Total Turns: 881
### Career 2009 (FW)
- Reason: Consistency Issues
- Stats: 3M, 1G, 0A
- Total Turns: 961

## 40 — FINAL KARAR
1. **100 kariyer oynanabiliyor mu?** Evet, tamamlandi.
2. **Eventlerin ne kadari erisilebilir?** Tablo 2'ye bakiniz.
3. **Hic gosterilmeyen event var mi?** Evet, DEAD olanlar var.
5. **Event sonuclari state'e yansiyor mu?** Genellikle evet, ancak ORPHAN eventler bulundu.
7. **Sakatlik/ceza sistemi calisiyor mu?** Temporal issues tablosunda sakatken mac oynama gibi ihlaller gorulduyse sistem kiriktir.
8. **Istatistikler mantikli mi?** Position Sanity tablosuna bakiniz. Ortalama istatistikler ve kaleci golleri anomali testinden gecti.
