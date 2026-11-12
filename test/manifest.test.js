// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The store indexer validates the manifest, but nothing there knows which
// handlers the code registers: these tests keep both sides in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  MODE_KINDS,
  OBJECT_KINDS,
  SCENE_ACTIONS,
  SCENE_TRIGGERS,
} from '../src/capabilities/scenes.js';
import { WIDGET_KEYS } from '../src/capabilities/widgets.js';
import { DEFAULT_CONFIG, MFA_METHODS, REFRESH_INTERVAL_BOUNDS } from '../src/config.js';
import { LANGUAGES } from '../src/i18n.js';

const read = async (path) => readFile(new URL(path, import.meta.url), 'utf8');
const manifest = JSON.parse(await read('../gladys-assistant-integration.json'));
const pkg = JSON.parse(await read('../package.json'));
const indexSource = await read('../index.js');

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.docker_image, `ghcr.io/prohand/gladys-arlo:${manifest.version}`);
  assert.match(
    manifest.cover_image,
    /^https:\/\/raw\.githubusercontent\.com\/prohand\/gladys-arlo\//,
  );
});

test('Arlo is a cloud integration: the transport badge says so', () => {
  assert.deepEqual(manifest.transports, ['cloud']);
  assert.ok(manifest.keywords.includes('cloud'));
});

test('the name and the description fit what the store allows', () => {
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  for (const language of LANGUAGES) {
    const { length } = manifest.description[language];
    assert.ok(length >= 10 && length <= 100, `description.${language}: ${length} characters`);
  }
});

test('every manifest action is registered in index.js', () => {
  for (const action of manifest.actions) {
    assert.match(indexSource, new RegExp(`onAction\\('${action.key}'`), action.key);
  }
});

test('scene actions: the manifest and the handlers agree', () => {
  assert.deepEqual(
    manifest.scene_actions.map((action) => action.key).sort(),
    Object.values(SCENE_ACTIONS).sort(),
  );
  assert.match(indexSource, /onSceneAction\(SCENE_ACTIONS\[key\]/);
  for (const action of manifest.scene_actions) {
    assert.ok(action.timeout_seconds >= 5 && action.timeout_seconds <= 120);
    for (const output of action.outputs) {
      assert.ok(['string', 'number', 'boolean'].includes(output.type), output.key);
    }
  }
});

test('scene triggers: the manifest declares what the code fires', () => {
  assert.deepEqual(
    manifest.scene_triggers.map((trigger) => trigger.key).sort(),
    Object.values(SCENE_TRIGGERS).sort(),
  );
  const options = (triggerKey, fieldKey) =>
    manifest.scene_triggers
      .find((trigger) => trigger.key === triggerKey)
      .fields.find((field) => field.key === fieldKey)
      .options.map((option) => option.value)
      .sort();
  assert.deepEqual(options(SCENE_TRIGGERS.OBJECT_DETECTED, 'object'), [...OBJECT_KINDS].sort());
  assert.deepEqual(options(SCENE_TRIGGERS.MODE_CHANGED, 'mode'), [...MODE_KINDS].sort());
});

test('widgets: the manifest and the handlers agree', () => {
  assert.deepEqual(
    manifest.widgets.map((widget) => widget.key).sort(),
    Object.values(WIDGET_KEYS).sort(),
  );
  assert.ok(manifest.widgets.length <= 5);
  assert.match(indexSource, /onWidgetGet\(WIDGET_KEYS\.OVERVIEW/);
  assert.match(indexSource, /onWidgetGet\(WIDGET_KEYS\.CAMERA/);
  assert.match(indexSource, /onWidgetGetImage\(/);
});

// The store schema is the admission authority.
const FIELD_TYPES = [
  'string',
  'number',
  'boolean',
  'select',
  'multi_select',
  'secret',
  'oauth2',
  'section',
];

test('every field uses a type and a shape the store accepts', () => {
  const fields = [
    ...manifest.config_schema,
    ...manifest.actions.flatMap((a) => a.fields ?? []),
    ...manifest.widgets.flatMap((w) => w.settings ?? []),
    ...manifest.scene_triggers.flatMap((t) => t.fields ?? []),
    ...manifest.scene_actions.flatMap((a) => a.fields ?? []),
  ];
  for (const field of fields) {
    assert.ok(FIELD_TYPES.includes(field.type), `${field.key}: ${field.type}`);
    assert.match(field.key, /^[a-z0-9_]+$/);
    if (field.placeholder !== undefined) {
      assert.equal(typeof field.placeholder, 'object', `${field.key}: placeholder object`);
      assert.ok(['string', 'number', 'secret'].includes(field.type), field.key);
    }
    if (field.min !== undefined || field.max !== undefined) {
      assert.equal(field.type, 'number', `${field.key}: min/max are number-only`);
    }
    if (field.source !== undefined) {
      assert.equal(field.source, 'devices');
      assert.equal(field.options, undefined, `${field.key}: source and options together`);
    }
  }
});

test('config_schema defaults match DEFAULT_CONFIG, and every key is known', () => {
  for (const field of manifest.config_schema) {
    if (field.type === 'section') {
      assert.ok(!(field.key in DEFAULT_CONFIG));
      assert.equal(field.default, undefined);
      for (const link of field.links ?? []) {
        assert.match(link.url, /^https:\/\//);
      }
      continue;
    }
    assert.ok(field.key in DEFAULT_CONFIG, `config key "${field.key}" missing in DEFAULT_CONFIG`);
    if (field.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[field.key], field.default, field.key);
    }
  }
  const mfa = manifest.config_schema.find((field) => field.key === 'mfa_method');
  assert.deepEqual(
    mfa.options.map((o) => o.value),
    MFA_METHODS,
  );
  const refresh = manifest.config_schema.find((field) => field.key === 'refresh_interval');
  assert.deepEqual({ min: refresh.min, max: refresh.max }, REFRESH_INTERVAL_BOUNDS);
});

test('the password is a secret field', () => {
  assert.equal(manifest.config_schema.find((field) => field.key === 'password').type, 'secret');
});

const CATEGORIES = [
  'climate',
  'lighting',
  'energy',
  'security',
  'multimedia',
  'appliances',
  'environment',
  'protocols',
  'network',
  'notifications',
  'assistants',
  'services',
  'transport',
  'vehicles',
  'servers',
  'leisure',
];

test('categories and keywords follow the store rules', () => {
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  for (const category of manifest.categories) {
    assert.ok(CATEGORIES.includes(category), category);
  }
  const keywords = manifest.keywords.map((k) => k.trim().toLowerCase());
  assert.ok(keywords.length >= 1 && keywords.length <= 10);
  assert.equal(new Set(keywords).size, keywords.length);
  for (const keyword of keywords) {
    assert.ok(keyword.length >= 2 && keyword.length <= 30, keyword);
  }
});

test('the Gladys floor covers every field the manifest declares', () => {
  // categories: 4.86; widgets, scene declarations: 5.1; keywords: 5.3.
  const [major, minor] = manifest.gladys_version.replace(/^>=/, '').split('.').map(Number);
  assert.ok(major > 5 || (major === 5 && minor >= 3), manifest.gladys_version);
});

/** Every multi-language object of the manifest, with where it sits. */
function multiLanguageTexts(node, path = 'manifest') {
  if (Array.isArray(node)) {
    return node.flatMap((child, index) => multiLanguageTexts(child, `${path}[${index}]`));
  }
  if (node === null || typeof node !== 'object') {
    return [];
  }
  const keys = Object.keys(node);
  if (keys.includes('en') && keys.every((key) => /^[a-z]{2}$/.test(key))) {
    return [{ path, text: node }];
  }
  return keys.flatMap((key) => multiLanguageTexts(node[key], `${path}.${key}`));
}

test('every text of the manifest carries en, fr, de and es', () => {
  const texts = multiLanguageTexts(manifest);
  assert.ok(texts.length > 50, `only ${texts.length} texts found`);
  for (const { path, text } of texts) {
    assert.deepEqual(Object.keys(text).sort(), [...LANGUAGES].sort(), path);
    for (const language of LANGUAGES) {
      assert.ok(String(text[language]).trim().length > 0, `${path}.${language} is empty`);
    }
  }
});

test('the per-language length limits of the store hold in every language', () => {
  const within = (text, min, max, where) => {
    for (const language of LANGUAGES) {
      const { length } = text[language];
      assert.ok(length >= min && length <= max, `${where}.${language}: ${length} characters`);
    }
  };
  for (const widget of manifest.widgets) {
    within(widget.label, 3, 30, `widget ${widget.key} label`);
    within(widget.description, 1, 100, `widget ${widget.key} description`);
  }
  for (const section of manifest.config_schema.filter((field) => field.type === 'section')) {
    within(section.description, 1, 1000, `section ${section.key} description`);
  }
});

test('the user documentation exists in every language', async () => {
  for (const language of LANGUAGES) {
    const text = await read(`../docs/${language}.md`);
    assert.ok(text.length > 1000, `docs/${language}.md is too short`);
    for (const key of [...Object.values(SCENE_TRIGGERS), ...Object.values(WIDGET_KEYS)]) {
      assert.ok(text.includes(key), `docs/${language}.md does not mention ${key}`);
    }
  }
});
