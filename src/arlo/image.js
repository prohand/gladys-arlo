// -----------------------------------------------------------------------------
// Fit an Arlo picture into the size Gladys accepts.
//
// Gladys takes camera images of at most 150 KB and widget images of at most
// 300 KB, and never recompresses them. An Arlo full-frame snapshot is a 1080p
// JPEG, often 200 to 500 KB: it is halved (box filter) and re-encoded until it
// fits. jpeg-js is pure JavaScript: no native build in the multi-arch image.
// -----------------------------------------------------------------------------

import jpeg from 'jpeg-js';

/** Gladys camera image limit (publishCameraImage / onGetImage). */
export const CAMERA_IMAGE_MAX_BYTES = 150 * 1024;

/** Gladys widget image limit (onWidgetGetImage). */
export const WIDGET_IMAGE_MAX_BYTES = 300 * 1024;

const JPEG_MAGIC = [0xff, 0xd8, 0xff];

export function isJpeg(buffer) {
  return JPEG_MAGIC.every((byte, index) => buffer?.[index] === byte);
}

/** Halve a decoded RGBA image, averaging each 2×2 block. */
function halve({ width, height, data }) {
  const w = Math.max(1, Math.floor(width / 2));
  const h = Math.max(1, Math.floor(height / 2));
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      for (let c = 0; c < 4; c += 1) {
        let sum = 0;
        let count = 0;
        for (let dy = 0; dy < 2; dy += 1) {
          for (let dx = 0; dx < 2; dx += 1) {
            const sx = Math.min(width - 1, x * 2 + dx);
            const sy = Math.min(height - 1, y * 2 + dy);
            sum += data[(sy * width + sx) * 4 + c];
            count += 1;
          }
        }
        out[(y * w + x) * 4 + c] = Math.round(sum / count);
      }
    }
  }
  return { width: w, height: h, data: out };
}

/**
 * The picture as is when it fits, else a smaller JPEG that does.
 * @param {Buffer} buffer a JPEG
 * @param {number} maxBytes
 * @returns {Buffer}
 */
export function fitJpeg(buffer, maxBytes) {
  if (buffer.length <= maxBytes) {
    return buffer;
  }
  if (!isJpeg(buffer)) {
    throw new Error('The Arlo picture is not a JPEG');
  }
  let image = jpeg.decode(buffer, { useTArray: true, maxMemoryUsageInMB: 256 });
  // A smaller quality first: often enough, and keeps the resolution.
  for (const quality of [75, 60]) {
    const encoded = jpeg.encode(image, quality).data;
    if (encoded.length <= maxBytes) {
      return Buffer.from(encoded);
    }
  }
  while (image.width > 16) {
    image = halve(image);
    const encoded = jpeg.encode(image, 70).data;
    if (encoded.length <= maxBytes) {
      return Buffer.from(encoded);
    }
  }
  throw new Error('The Arlo picture cannot be made small enough');
}

/** `image/jpg;base64,...`, the format of the Gladys camera channel. */
export function toCameraImage(buffer) {
  return `image/jpg;base64,${fitJpeg(buffer, CAMERA_IMAGE_MAX_BYTES).toString('base64')}`;
}

/** Raw base64, the format of the Gladys widget images. */
export function toWidgetImage(buffer) {
  return fitJpeg(buffer, WIDGET_IMAGE_MAX_BYTES).toString('base64');
}
