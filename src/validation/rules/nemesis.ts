/**
 * RAKIP ARKI KURALLARI.
 *
 * Ark motorun SIRAYLA kuyruga aldigi tek yaydir; bir asamanin olayi eksikse
 * yay sessizce durur ve oyuncu bunu hicbir zaman fark etmez. Bu yuzden
 * eksiklik build zamaninda yakalanmali.
 */

import { finding, type Finding, type RuleContext, type ValidationRule } from '../Rule.js';

export const NemesisArcRule: ValidationRule = {
  name: 'NemesisArcRule',
  defaultSeverity: 'error',
  description: 'Rakip arkinin her asamasi ve finali var olan bir olaya isaret etmeli.',

  check(ctx: RuleContext): Finding[] {
    const out: Finding[] = [];
    const slots = ctx.registry.slots;

    for (const arc of ctx.registry.config.nemeses) {
      const at = (p: string): string => `nemeses.${arc.id}.${p}`;

      const slot = slots.get(arc.slotRef);
      if (!slot) {
        out.push(
          finding(NemesisArcRule, undefined, `Tanimsiz slot: "${arc.slotRef}"`, {
            path: at('slotRef'),
            fix: 'roles.json icinde bu id ile bir slot tanimlayin.',
          }),
        );
      } else if (slot.scope !== 'world') {
        out.push(
          finding(NemesisArcRule, undefined, `"${arc.slotRef}" world-scope degil (${slot.scope}).`, {
            path: at('slotRef'),
            fix: 'Rakip transferde degismemeli; slotu world scope yapin.',
          }),
        );
      }

      if (arc.stages.length === 0) {
        out.push(
          finding(NemesisArcRule, undefined, 'Ark bos: hic asama yok.', { path: at('stages') }),
        );
      }

      arc.stages.forEach((stage, i) => {
        if (stage.stage !== i + 1) {
          out.push(
            finding(
              NemesisArcRule,
              undefined,
              `Asama numaralari 1'den baslayip kesintisiz artmali; ${i + 1}. sirada ${stage.stage} var.`,
              { path: at(`stages[${i}].stage`), fix: 'Bosluk birakmayin; motor `arcStage + 1` arar.' },
            ),
          );
        }
        if (!ctx.registry.get(stage.eventId)) {
          out.push(
            finding(NemesisArcRule, undefined, `Asama olayi bulunamadi: "${stage.eventId}"`, {
              path: at(`stages[${i}].eventId`),
              fix: 'Olayi yazin ya da asamayi listeden cikarin -- yay burada sessizce durur.',
            }),
          );
        }
      });

      // Kosulsuz final olmazsa ark tamamlanip hicbir sey olmayabilir.
      if (arc.resolutions.length > 0 && !arc.resolutions.some((r) => r.condition === undefined)) {
        out.push(
          finding(NemesisArcRule, undefined, 'Kosulsuz bir final yok; ark cozumsuz kalabilir.', {
            path: at('resolutions'),
            fix: 'Son finali kosulsuz birakin (yedek olarak).',
          }),
        );
      }

      arc.resolutions.forEach((r, i) => {
        if (!ctx.registry.get(r.eventId)) {
          out.push(
            finding(NemesisArcRule, undefined, `Final olayi bulunamadi: "${r.eventId}"`, {
              path: at(`resolutions[${i}].eventId`),
              fix: 'Finali yazin; ark tamamlandiginda motor bunu zorunlu olarak kuyruga alir.',
            }),
          );
        }
      });

      const unconditional = arc.resolutions.findIndex((r) => r.condition === undefined);
      if (unconditional >= 0 && unconditional < arc.resolutions.length - 1) {
        out.push(
          finding(NemesisArcRule, undefined, 'Kosulsuz final sonda degil; sonrakiler hic secilmez.', {
            path: at(`resolutions[${unconditional}]`),
            fix: 'Kosulsuz finali listenin sonuna alin.',
          }),
        );
      }
    }
    return out;
  },
};
