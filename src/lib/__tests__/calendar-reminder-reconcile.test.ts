import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  pending: [] as Array<{ identifier: string; content: { data: Record<string, unknown> } }>,
}));
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-notifications', () => ({
  setNotificationChannelAsync: vi.fn(async () => undefined),
  getAllScheduledNotificationsAsync: vi.fn(async () => h.pending),
  cancelScheduledNotificationAsync: vi.fn(async () => undefined),
  scheduleNotificationAsync: vi.fn(async () => 'id'),
  AndroidImportance: { HIGH: 4 },
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));

import * as Notifications from 'expo-notifications';
import { reconcileReminders, cancelReminders, withReminderLock, DATA_TAG } from '../calendar-reminder-reconcile';

const alert = (key: string, over: Record<string, unknown> = {}) => ({
  key, eventId: key, kind: 'event', title: 'T', body: 'B',
  fireTimeMs: Date.now() + 60_000, startMs: Date.now() + 120_000, ...over,
}) as never;
const req = (identifier: string, key: string, kind = 'event', locale = 'en') => ({
  identifier, content: { data: { tag: DATA_TAG, key, kind, locale } },
});

beforeEach(() => { h.pending = []; vi.clearAllMocks(); });

describe('reconcileReminders', () => {
  it('cancels reminders that are no longer wanted and adds missing ones', async () => {
    h.pending = [req('p1', 'old'), req('p2', 'keep')];
    await reconcileReminders([alert('keep'), alert('new')], 'en');
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('p1');
    expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalledWith('p2');
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it('with kinds: ["event"] leaves task reminders alone', async () => {
    h.pending = [req('t1', 'task-key', 'task'), req('e1', 'gone', 'event')];
    await reconcileReminders([], 'en', { kinds: ['event'] });
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(1);
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('e1');
  });

  it('rewords a reminder scheduled in another language', async () => {
    h.pending = [req('p1', 'k', 'event', 'de')];
    await reconcileReminders([alert('k')], 'en');
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('p1');
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it('schedules with a deterministic identifier so concurrent runs cannot duplicate', async () => {
    await reconcileReminders([alert('k1')], 'en');
    expect(vi.mocked(Notifications.scheduleNotificationAsync).mock.calls[0][0]).toMatchObject({
      identifier: 'bulwark-cal:k1',
    });
  });

  it('survives one failing schedule', async () => {
    vi.mocked(Notifications.scheduleNotificationAsync).mockRejectedValueOnce(new Error('bad'));
    await reconcileReminders([alert('a'), alert('b')], 'en');
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(2);
  });
});

describe('cancelReminders', () => {
  it('cancels only the given kinds and ignores foreign notifications', async () => {
    h.pending = [req('e', 'k1', 'event'), req('t', 'k2', 'task'), { identifier: 'x', content: { data: {} } }];
    await cancelReminders(['event']);
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(1);
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('e');
  });
});

describe('withReminderLock', () => {
  it('runs overlapping refreshes one after the other, so a stale snapshot cannot undo a newer one', async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    const first = withReminderLock(async () => {
      order.push('first:start');
      await new Promise<void>((resolve) => { releaseFirst = resolve; });
      order.push('first:end');
    });
    const second = withReminderLock(async () => { order.push('second'); });
    await Promise.resolve();
    expect(order).toEqual(['first:start']);
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(['first:start', 'first:end', 'second']);
  });

  it('keeps going after a run that rejects', async () => {
    await expect(withReminderLock(async () => { throw new Error('x'); })).rejects.toThrow('x');
    await expect(withReminderLock(async () => 'ok')).resolves.toBe('ok');
  });
});
