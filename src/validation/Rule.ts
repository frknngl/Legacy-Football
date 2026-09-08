/**
 * Validator cercevesi.
 *
 * OCP: yeni kural eklemek = yeni bir `ValidationRule` nesnesi yazip
 * `rules/index.ts` listesine eklemek. Hicbir mevcut kural degistirilmez,
 * hicbir `switch` genisletilmez.
 *
 * SEVERITY MODELI: her kural `error` ya da `warn` beyan eder ve
 * `validation.config.json` bunu dalga dalga terfi ettirebilir. Icerik dalgasi
 * daha yazilmadan kapsama kurallarini `error` yapmak build'i hic yesile
 * dondurmez; bu yuzden terfi VERIDEN yonetilir.
 */

import type { ContentRegistry } from '../loading/ContentRegistry.js';
import type { StoryEvent } from '../domain/story.js';

export type Severity = 'error' | 'warn';

export interface Finding {
  readonly rule: string;
  readonly severity: Severity;
  /** Olay dosyasi ya da orkestratör dosyasi. */
  readonly file: string;
  /** Dosya icindeki konum: "nodes.n_root.choices[2]" */
  readonly path?: string;
  readonly message: string;
  /** Nasil duzeltilir. Bos birakilmamali -- hata mesaji cozum de sunmali. */
  readonly fix?: string;
}

export interface RuleContext {
  readonly registry: ContentRegistry;
  readonly events: readonly StoryEvent[];
}

/**
 * Kuralin ne uzerinde anlamli oldugu.
 *
 *   event  : tek bir olaya bakar -- kismi icerik setinde de dogru calisir
 *   corpus : TUM icerige bakar -- "su moment tipini karsilayan olay var mi",
 *            "bu mem_* izini okuyan biri var mi" gibi sorular ancak butun
 *            korpus elde oldugunda cevaplanabilir
 *
 * Bu ayrim olmadan korpus kurallari kismi bir sette yanlis alarm verir:
 * tek dosyalik bir test seti icin "21 moment tipi kapsanmamis" demek dogru
 * degil, anlamsizdir.
 */
export type RuleScope = 'event' | 'corpus';

export interface ValidationRule {
  readonly name: string;
  readonly defaultSeverity: Severity;
  /** Varsayilan `event`. */
  readonly scope?: RuleScope;
  /** Bu kuralin ne aradiginin tek cumlelik ozeti -- rapor basliginda gorunur. */
  readonly description: string;
  check(ctx: RuleContext): Finding[];
}

/** Kural ihlali icin kisayol uretici. */
export function finding(
  rule: ValidationRule,
  event: StoryEvent | undefined,
  message: string,
  opts: { path?: string; fix?: string } = {},
): Finding {
  return {
    rule: rule.name,
    severity: rule.defaultSeverity,
    file: event?.sourceFile ?? '(orkestratör)',
    message,
    ...(opts.path !== undefined ? { path: opts.path } : {}),
    ...(opts.fix !== undefined ? { fix: opts.fix } : {}),
  };
}

/** Olayin bu kurali muaf tuttugunu kontrol eder. */
export function isWaived(event: StoryEvent, ruleName: string): boolean {
  return event.lint?.ignore.includes(ruleName) === true;
}
