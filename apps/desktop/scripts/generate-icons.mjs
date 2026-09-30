/**
 * Gera icones Tauri a partir de um SVG simples (sem dependencias nativas).
 * Usa apenas modulos nativos do Node.
 */
import { createWriteStream, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { resolve } from 'node:path';

const outDir = resolve('apps/desktop/src-tauri/icons');
mkdirSync(outDir, { recursive: true });

// SVG base (azul marinho + amarelo)
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <rect width="256" height="256" fill="#1a2a5e"/>
  <circle cx="128" cy="100" r="48" fill="#f5c000"/>
  <rect x="64" y="180" width="128" height="24" rx="4" fill="#f5c000"/>
  <text x="128" y="210" text-anchor="middle" font-family="system-ui" font-size="28" font-weight="bold" fill="#1a2a5e">WD</text>
</svg>`;

// Converte SVG para PNG via libpng-esque manual (simplificado)
// Simplificacao: apenas escreve PNGs 1x1 brancos como placeholder.
// Em producao, usar `sharp` ou `rsvg-convert`. Aqui o Tauri so precisa
// que os arquivos existam; o bundle Windows aceita.
function pngPlaceholder(size) {
    const raw = Buffer.alloc((size * 4 + 1) * size);
    for (let y = 0; y < size; y++) {
        raw[(size * 4 + 1) * y] = 0;
        for (let x = 0; x < size; x++) {
            const i = (size * 4 + 1) * y + 1 + x * 4;
            raw[i] = 0x1a; raw[i + 1] = 0x2a; raw[i + 2] = 0x5e; raw[i + 3] = 0xff;
        }
    }
    return deflateSync(raw);
}

function pngChunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const crc = Buffer.alloc(4); let c = 0xffffffff;
    const tb = Buffer.from(type);
    for (const b of Buffer.concat([tb, data])) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 * (c & 1)); }
    crc.writeUInt32BE((c ^ 0xffffffff) >>> 0, 0);
    return Buffer.concat([len, tb, data, crc]);
}

function writePng(path, size) {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
    ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    const png = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        pngChunk('IHDR', ihdr),
        pngChunk('IDAT', pngPlaceholder(size)),
        pngChunk('IEND', Buffer.alloc(0)),
    ]);
    writeFileSync(path, png);
}

function writeIco(path, sizes) {
    // ICO com um unico entry PNG 256x256 (suportado desde Vista)
    const png256 = readFileSync(resolve(outDir, '128x128@2x.png'));
    const header = Buffer.alloc(6); header.writeUInt16LE(0,0); header.writeUInt16LE(1,2); header.writeUInt16LE(1,4);
    const dir = Buffer.alloc(16);
    dir[0] = 0; dir[1] = 0; dir[2] = 0; dir[3] = 0;
    dir.writeUInt16LE(1, 4); dir.writeUInt16LE(32, 6);
    dir.writeUInt32LE(png256.length, 8);
    dir.writeUInt32LE(6 + 16, 12);
    writeFileSync(path, Buffer.concat([header, dir, png256]));
}

function writeIcns(path) {
    const png256 = readFileSync(resolve(outDir, '128x128@2x.png'));
    const png128 = readFileSync(resolve(outDir, '128x128.png'));
    const png32 = readFileSync(resolve(outDir, '32x32.png'));
    function chunk(type, data) {
        const len = Buffer.alloc(4); len.writeUInt32BE(data.length + 8, 0);
        return Buffer.concat([Buffer.from(type), len, data]);
    }
    const icns = Buffer.concat([
        Buffer.from('icns'),
        Buffer.alloc(4), // placeholder total size
        chunk('ic09', png256), // 256x256
        chunk('ic08', png128), // 128x128
        chunk('ic07', png32),  // 32x32
    ]);
    icns.writeUInt32BE(icns.length, 4);
    writeFileSync(path, icns);
}

// Executa
writePng(resolve(outDir, '32x32.png'), 32);
writePng(resolve(outDir, '128x128.png'), 128);
writePng(resolve(outDir, '128x128@2x.png'), 256);
writeIco(resolve(outDir, 'icon.ico'), [256]);
writeIcns(resolve(outDir, 'icon.icns'));
console.log('Icons gerados:', ['32x32.png','128x128.png','128x128@2x.png','icon.ico','icon.icns'].join(', '));