/** Motorun firlattigi tum hatalarin ortak koku. */
export class EngineError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** Icerik yuklenirken/ayristirilirken olusan hata. */
export class ContentError extends EngineError {
  constructor(
    message: string,
    readonly source: string,
  ) {
    super(`${source}: ${message}`, 'CONTENT');
  }
}

/** Registry'de tanimsiz flag'e erisim. */
export class UnknownFlagError extends EngineError {
  constructor(readonly flag: string) {
    super(`Tanimsiz flag: "${flag}". content/orchestrator/core.json icinde beyan edilmeli.`, 'UNKNOWN_FLAG');
  }
}

/** Gecersiz durum gecisi (LifeStateMachine). */
export class InvalidTransitionError extends EngineError {
  constructor(from: string, to: string) {
    super(`Gecersiz hayat durumu gecisi: ${from} -> ${to}`, 'INVALID_TRANSITION');
  }
}

/** Motor yanlis sirada cagrildi (ornegin acik karar varken advanceTurn). */
export class EngineStateError extends EngineError {
  constructor(message: string) {
    super(message, 'ENGINE_STATE');
  }
}
