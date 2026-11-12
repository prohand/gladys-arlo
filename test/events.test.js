import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSseParser, EventStream } from '../src/arlo/events.js';

test('the parser joins chunks and keeps JSON events only', () => {
  const messages = [];
  const parse = createSseParser((message) => messages.push(message));
  parse('data: {"status":"connected"}\n\nda');
  parse('ta: {"resource":"cameras/CAM1",');
  parse('"properties":{"motionDetected":true}}\r\n\r\n');
  parse(': keep-alive\n\ndata: not json\n\n');
  assert.deepEqual(messages, [
    { status: 'connected' },
    { resource: 'cameras/CAM1', properties: { motionDetected: true } },
  ]);
});

test('the stream hands the events over and reports its status', async () => {
  const body = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode('data: {"status":"connected"}\n\n'));
      controller.enqueue(
        encoder.encode('data: {"resource":"doorbells/B","properties":{"buttonPressed":true}}\n\n'),
      );
      controller.close();
    },
  });
  const messages = [];
  const statuses = [];
  let opened = 0;
  const stream = new EventStream({
    client: {
      openEventStream: async () => {
        opened += 1;
        if (opened > 1) {
          stream.stop();
          throw new Error('stopped');
        }
        return { body };
      },
    },
    onMessage: (message) => messages.push(message),
    onStatus: (connected) => statuses.push(connected),
  });
  stream.start();
  await new Promise((resolve) => setTimeout(resolve, 20));
  stream.stop();
  assert.deepEqual(messages, [{ resource: 'doorbells/B', properties: { buttonPressed: true } }]);
  assert.deepEqual(statuses, [true, false]);
});

test('a refused session stops the stream and says so', async () => {
  let authErrors = 0;
  const stream = new EventStream({
    client: {
      openEventStream: async () => {
        const err = new Error('401');
        err.isAuthError = true;
        throw err;
      },
    },
    onMessage: () => {},
    onAuthError: () => {
      authErrors += 1;
    },
  });
  stream.start();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(authErrors, 1);
  assert.equal(stream.running, false);
});
