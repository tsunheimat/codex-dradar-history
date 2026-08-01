import crypto from "node:crypto";
import sharp from "sharp";

export const IMAGE_TILE_SIZE = 256;
// Comics are one-shot generated images — measured across the live archive, no
// tile is ever shared between two comics, so lossless storage buys nothing and
// costs ~4x. q90 WebP is visually near-identical on this content (text stays
// crisp) at ~1/4 the bytes. Tile hashes are still sha256 of the DECODED SOURCE
// pixels, so identity/dedup semantics are unchanged by the lossy encoding.
export const COMIC_WEBP_QUALITY = 90;

export async function encodeTileWebp(raw, { width, height, channels }) {
  return sharp(raw, { raw: { width, height, channels } })
    .webp({ quality: COMIC_WEBP_QUALITY, effort: 6, smartSubsample: true })
    .toBuffer();
}

/** True when a WebP buffer uses the lossless (VP8L) encoding. */
export function isLosslessWebp(buf) {
  if (!buf || buf.length < 16) return false;
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WEBP") return false;
  let off = 12;
  while (off + 8 <= buf.length) {
    const fourcc = buf.toString("ascii", off, off + 4);
    if (fourcc === "VP8L") return true;
    if (fourcc === "VP8 ") return false;
    const size = buf.readUInt32LE(off + 4);
    off += 8 + size + (size % 2); // chunks are 2-byte aligned
  }
  return false;
}

const COMIC_ASSET_RE = /^assets\/radar-high-readout-comic-\d{8}-\d{4}\.png$/;

export function isCompositeComicAssetPath(assetPath) {
  return COMIC_ASSET_RE.test(String(assetPath));
}

function tileHash(width, height, channels, raw) {
  return crypto
    .createHash("sha256")
    .update(Buffer.from(`pixels:${width}x${height}x${channels}:`, "utf8"))
    .update(raw)
    .digest("hex");
}

export async function tileComicPng(body, tileSize = IMAGE_TILE_SIZE) {
  const decoded = await sharp(body).raw().toBuffer({ resolveWithObject: true });
  const { data, info } = decoded;
  const channels = info.channels;
  if (channels !== 3 && channels !== 4) throw new Error(`expected RGB/RGBA image, got ${channels} channels`);
  const tiles = [];
  for (let y = 0; y < info.height; y += tileSize) {
    for (let x = 0; x < info.width; x += tileSize) {
      const width = Math.min(tileSize, info.width - x);
      const height = Math.min(tileSize, info.height - y);
      const raw = Buffer.alloc(width * height * channels);
      for (let row = 0; row < height; row++) {
        const srcStart = ((y + row) * info.width + x) * channels;
        data.copy(raw, row * width * channels, srcStart, srcStart + width * channels);
      }
      const hash = tileHash(width, height, channels, raw);
      const encoded = await encodeTileWebp(raw, { width, height, channels });
      tiles.push({ hash, bytes: encoded.length, body: encoded, x, y, width, height });
    }
  }
  return {
    width: info.width,
    height: info.height,
    tileSize,
    channels,
    contentType: "image/png",
    tiles,
  };
}

export async function composeTiledPng(manifest, getTile) {
  const channels = manifest.channels || 4;
  const canvas = Buffer.alloc(manifest.width * manifest.height * channels);
  for (const tile of manifest.tiles) {
    const body = await getTile(tile.hash);
    if (!body) throw new Error(`missing image tile ${tile.hash}`);
    const decoded = await (channels === 4 ? sharp(body).ensureAlpha() : sharp(body))
      .raw().toBuffer({ resolveWithObject: true });
    if (decoded.info.width !== tile.width || decoded.info.height !== tile.height) {
      throw new Error(`image tile dimensions do not match manifest for ${tile.hash}`);
    }
    if (decoded.info.channels !== channels) {
      throw new Error(`image tile channels do not match manifest for ${tile.hash}`);
    }
    for (let row = 0; row < tile.height; row++) {
      const srcStart = row * tile.width * channels;
      const dstStart = ((tile.y + row) * manifest.width + tile.x) * channels;
      decoded.data.copy(canvas, dstStart, srcStart, srcStart + tile.width * channels);
    }
  }
  return sharp(canvas, {
    raw: { width: manifest.width, height: manifest.height, channels },
  }).png({ compressionLevel: 9, effort: 10, palette: false }).toBuffer();
}
