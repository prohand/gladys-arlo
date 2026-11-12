import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetImage } from '@gladysassistant/integration-sdk';
import {
  CAMERA_IMAGE_MAX_BYTES,
  fitJpeg,
  isJpeg,
  toCameraImage,
  toWidgetImage,
} from '../src/arlo/image.js';
import { bigJpeg, TINY_JPEG } from './helpers/fakeArlo.js';

test('a small picture is kept as is', () => {
  assert.equal(fitJpeg(TINY_JPEG, CAMERA_IMAGE_MAX_BYTES), TINY_JPEG);
  assert.equal(toCameraImage(TINY_JPEG), `image/jpg;base64,${TINY_JPEG.toString('base64')}`);
});

test('a large picture is made to fit 150 KB and stays a JPEG', () => {
  const big = bigJpeg();
  assert.ok(big.length > CAMERA_IMAGE_MAX_BYTES);
  const fitted = fitJpeg(big, CAMERA_IMAGE_MAX_BYTES);
  assert.ok(fitted.length <= CAMERA_IMAGE_MAX_BYTES);
  assert.ok(isJpeg(fitted));
});

test('widget images pass the SDK validation', () => {
  assert.deepEqual(validateWidgetImage(toWidgetImage(bigJpeg())), []);
});

test('a large non-JPEG is refused', () => {
  assert.throws(() => fitJpeg(Buffer.alloc(CAMERA_IMAGE_MAX_BYTES + 1), CAMERA_IMAGE_MAX_BYTES));
});
