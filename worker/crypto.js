import { AppError } from "./errors.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const additionalData = encoder.encode("easyissue-session-v1");

function assertSecret(secret) {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new AppError(500, "invalid_configuration", "SESSION_SECRET は32文字以上で設定してください");
  }
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlToBytes(value) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/");
  const base64 = padded.padEnd(Math.ceil(padded.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function deriveKey(secret) {
  assertSecret(secret);
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export function randomToken(byteLength = 32) {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export async function seal(payload, secret) {
  const key = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData },
    key,
    encoder.encode(JSON.stringify(payload))
  ));
  return `v1.${bytesToBase64Url(iv)}.${bytesToBase64Url(encrypted)}`;
}

export async function unseal(value, secret) {
  try {
    const [version, ivPart, encryptedPart] = String(value).split(".");
    if (version !== "v1" || !ivPart || !encryptedPart) return null;
    const key = await deriveKey(secret);
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64UrlToBytes(ivPart), additionalData },
      key,
      base64UrlToBytes(encryptedPart)
    );
    return JSON.parse(decoder.decode(decrypted));
  } catch {
    return null;
  }
}

export function constantTimeEqual(left, right) {
  const leftBytes = encoder.encode(String(left));
  const rightBytes = encoder.encode(String(right));
  const length = Math.max(leftBytes.length, rightBytes.length, 1);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}
