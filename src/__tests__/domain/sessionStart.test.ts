import { canStartFromTemplate, startFailureKey } from '../../domain/sessionStart';

describe('sessionStart', () => {
  it('only a workout with at least one exercise can be started', () => {
    expect(canStartFromTemplate({ exercises: [] })).toBe(false);
    expect(canStartFromTemplate({ exercises: [{} as never] })).toBe(true);
  });
  it('maps each start failure to its own message', () => {
    expect(startFailureKey({ kind: 'conflict', reason: 'active_session' })).toBe('liveSession.alreadyActive');
    expect(startFailureKey({ kind: 'not_found', entity: 'template' })).toBe('liveSession.templateGone');
    expect(startFailureKey({ kind: 'busy', message: 'x' })).toBe('liveSession.startFailed');
    expect(startFailureKey({ kind: 'unknown', message: 'x' })).toBe('liveSession.startFailed');
  });
});
