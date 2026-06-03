import { createHash } from 'node:crypto';

import { type ConstantPdaSeedNode, isNode, type PdaSeedNode, resolveNestedTypeNode } from '@codama/nodes';
import { ed25519 } from '@noble/curves/ed25519.js';
import { getBase58Decoder, getBase58Encoder } from '@solana/codecs-strings';

import { getBytesFromBytesValueNode } from './codecs';

function isOnCurve(bytes: Uint8Array): boolean {
    return ed25519.utils.isValidPublicKey(bytes);
}

/**
 * Mirrors Solana's `Pubkey::find_program_address`.
 * Returns the base58 address and bump, or `null` if no valid bump exists.
 */
export function findProgramAddress(
    seeds: Uint8Array[],
    programId: Uint8Array,
): { address: string; bump: number } | null {
    for (let bump = 255; bump >= 0; bump--) {
        const hash = createHash('sha256');
        for (const seed of seeds) {
            hash.update(seed);
        }
        hash.update(Uint8Array.from([bump]));
        hash.update(programId);
        hash.update(Buffer.from('ProgramDerivedAddress'));
        const candidate = hash.digest();

        if (!isOnCurve(candidate)) {
            return {
                address: getBase58Decoder().decode(candidate),
                bump,
            };
        }
    }
    return null;
}

function serializeNumber(value: number, format: string, endian: 'be' | 'le'): Uint8Array | null {
    const isLE = endian === 'le';
    switch (format) {
        case 'u8':
            return Uint8Array.from([value & 0xff]);
        case 'i8': {
            const buf = new ArrayBuffer(1);
            new DataView(buf).setInt8(0, value);
            return new Uint8Array(buf);
        }
        case 'u16': {
            const buf = new ArrayBuffer(2);
            new DataView(buf).setUint16(0, value, isLE);
            return new Uint8Array(buf);
        }
        case 'i16': {
            const buf = new ArrayBuffer(2);
            new DataView(buf).setInt16(0, value, isLE);
            return new Uint8Array(buf);
        }
        case 'u32': {
            const buf = new ArrayBuffer(4);
            new DataView(buf).setUint32(0, value, isLE);
            return new Uint8Array(buf);
        }
        case 'i32': {
            const buf = new ArrayBuffer(4);
            new DataView(buf).setInt32(0, value, isLE);
            return new Uint8Array(buf);
        }
        case 'f32': {
            const buf = new ArrayBuffer(4);
            new DataView(buf).setFloat32(0, value, isLE);
            return new Uint8Array(buf);
        }
        case 'f64': {
            const buf = new ArrayBuffer(8);
            new DataView(buf).setFloat64(0, value, isLE);
            return new Uint8Array(buf);
        }
        case 'u64':
        case 'i64': {
            const buf = new ArrayBuffer(8);
            const view = new DataView(buf);
            if (format === 'u64') view.setBigUint64(0, BigInt(value), isLE);
            else view.setBigInt64(0, BigInt(value), isLE);
            return new Uint8Array(buf);
        }
        case 'u128':
        case 'i128': {
            const bytes = new Uint8Array(16);
            const view = new DataView(bytes.buffer);
            const big = BigInt(value);
            const mask = (1n << 64n) - 1n;
            const lo = big & mask;
            const hi = (big >> 64n) & mask;
            if (isLE) {
                view.setBigUint64(0, lo, true);
                view.setBigUint64(8, hi, true);
            } else {
                view.setBigUint64(0, hi, false);
                view.setBigUint64(8, lo, false);
            }
            return bytes;
        }
        default:
            return null;
    }
}

function extractConstantSeedBytes(seed: ConstantPdaSeedNode, programAddress: string): Uint8Array | null {
    const { value } = seed;

    if (isNode(value, 'programIdValueNode')) {
        return getBase58Encoder().encode(programAddress) as Uint8Array;
    }
    if (isNode(value, 'stringValueNode')) {
        return new TextEncoder().encode(value.string);
    }
    if (isNode(value, 'bytesValueNode')) {
        return getBytesFromBytesValueNode(value);
    }
    if (isNode(value, 'numberValueNode')) {
        const resolvedType = resolveNestedTypeNode(seed.type);
        if (isNode(resolvedType, 'numberTypeNode')) {
            return serializeNumber(value.number, resolvedType.format, resolvedType.endian);
        }
        return null;
    }
    if (isNode(value, 'publicKeyValueNode')) {
        return getBase58Encoder().encode(value.publicKey) as Uint8Array;
    }

    return null;
}

/**
 * Computes a PDA address at codegen time for PDAs with only constant seeds.
 * Returns the base58 address string, or `null` if computation is not possible.
 */
export function computePdaAddress(seeds: readonly PdaSeedNode[], programAddress: string): string | null {
    try {
        const seedBytes: Uint8Array[] = [];
        for (const seed of seeds) {
            if (!isNode(seed, 'constantPdaSeedNode')) {
                return null;
            }
            const bytes = extractConstantSeedBytes(seed, programAddress);
            if (!bytes) return null;
            seedBytes.push(bytes);
        }

        const programIdBytes = getBase58Encoder().encode(programAddress) as Uint8Array;
        const result = findProgramAddress(seedBytes, programIdBytes);
        return result?.address ?? null;
    } catch {
        return null;
    }
}
