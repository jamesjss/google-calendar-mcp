const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function randomToken(bytes = 32): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function hashToken(token: string): Promise<string> {
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(token))));
}

export function constantTimeEqual(left: string, right: string): boolean {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return difference === 0;
}

export class SecretBox {
  private constructor(private readonly key: CryptoKey) {}

  static async fromBase64(value: string): Promise<SecretBox> {
    const bytes = base64UrlToBytes(value);
    if (bytes.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes");
    const key = await crypto.subtle.importKey("raw", bytes.buffer as ArrayBuffer, "AES-GCM", false, ["encrypt", "decrypt"]);
    return new SecretBox(key);
  }

  async encrypt(value: unknown): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, this.key, encoder.encode(JSON.stringify(value))));
    const packed = new Uint8Array(iv.length + ciphertext.length);
    packed.set(iv);
    packed.set(ciphertext, iv.length);
    return bytesToBase64Url(packed);
  }

  async decrypt<T>(value: string): Promise<T> {
    const packed = base64UrlToBytes(value);
    if (packed.length < 29) throw new Error("Encrypted value is malformed");
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: packed.slice(0, 12).buffer as ArrayBuffer },
      this.key,
      packed.slice(12).buffer as ArrayBuffer,
    );
    return JSON.parse(decoder.decode(plaintext)) as T;
  }
}
