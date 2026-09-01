import assert from 'node:assert/strict';
import test from 'node:test';

import { notifyOperationFailure } from '../../../module/helpers/notifications.mjs';

test('operation failures use the first matching localized namespace', () => {
  const notices = [];
  globalThis.game = {
    i18n: {
      localize(key) {
        return key === 'SWORDS_WIZARDRY.Roll.Error.ROLL_FAILED'
          ? 'Localized failure'
          : key;
      }
    }
  };
  globalThis.ui = {
    notifications: { warn: (message) => notices.push(message) }
  };

  const result = { status: 'failure', code: 'ROLL_FAILED' };
  assert.equal(notifyOperationFailure(result, ['SWORDS_WIZARDRY.Roll.Error']), result);
  assert.deepEqual(notices, ['Localized failure']);
  delete globalThis.game;
  delete globalThis.ui;
});

test('successful operations do not create notices', () => {
  globalThis.game = { i18n: { localize: (key) => key } };
  globalThis.ui = { notifications: { warn: () => assert.fail('unexpected notice') } };
  assert.equal(notifyOperationFailure({ status: 'success' }).status, 'success');
  delete globalThis.game;
  delete globalThis.ui;
});
