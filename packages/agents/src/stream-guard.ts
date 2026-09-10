import { normalizeText } from "@iom/documents";

export interface DeniedFingerprint {
  value: string;
  kind: "fingerprint" | "entity_value";
}

function comparable(text: string): string {
  return normalizeText(text)
    .toLocaleLowerCase("id-ID")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export class StreamReleaseGuard {
  readonly #denied: string[];
  readonly #releaseCharacters: number;
  #buffer = "";
  #blocked = false;

  constructor(fingerprints: readonly DeniedFingerprint[], releaseCharacters = 96) {
    this.#denied = fingerprints
      .map((item) => comparable(item.value))
      .filter((item) => item.length >= 8);
    this.#releaseCharacters = releaseCharacters;
  }

  get blocked(): boolean {
    return this.#blocked;
  }

  push(delta: string): { released: string; blocked: boolean } {
    if (this.#blocked) return { released: "", blocked: true };
    this.#buffer += delta;
    const normalized = comparable(this.#buffer);
    if (this.#denied.some((fingerprint) => normalized.includes(fingerprint))) {
      this.#buffer = "";
      this.#blocked = true;
      return { released: "", blocked: true };
    }
    if (this.#buffer.length <= this.#releaseCharacters) return { released: "", blocked: false };
    const releaseLength = this.#buffer.length - this.#releaseCharacters;
    const released = this.#buffer.slice(0, releaseLength);
    this.#buffer = this.#buffer.slice(releaseLength);
    return { released, blocked: false };
  }

  flush(): { released: string; blocked: boolean } {
    if (this.#blocked) return { released: "", blocked: true };
    const released = this.#buffer;
    this.#buffer = "";
    return { released, blocked: false };
  }
}
