import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  os: 'android',
  fcm: undefined as undefined | {
    scheduleCalendarReminderJob: ReturnType<typeof vi.fn>;
    cancelCalendarReminderJob: ReturnType<typeof vi.fn>;
  },
}));

vi.mock('react-native', () => ({
  Platform: { get OS() { return h.os; } },
  NativeModules: { get BulwarkFcm() { return h.fcm; } },
}));

import { setCalendarReminderJob } from '../calendar-reminder-job';

beforeEach(() => {
  h.os = 'android';
  h.fcm = {
    scheduleCalendarReminderJob: vi.fn(async () => true),
    cancelCalendarReminderJob: vi.fn(async () => undefined),
  };
});

describe('setCalendarReminderJob', () => {
  it('schedules the periodic job when enabled', async () => {
    await setCalendarReminderJob(true);
    expect(h.fcm!.scheduleCalendarReminderJob).toHaveBeenCalledTimes(1);
    expect(h.fcm!.cancelCalendarReminderJob).not.toHaveBeenCalled();
  });

  it('cancels it when disabled', async () => {
    await setCalendarReminderJob(false);
    expect(h.fcm!.cancelCalendarReminderJob).toHaveBeenCalledTimes(1);
    expect(h.fcm!.scheduleCalendarReminderJob).not.toHaveBeenCalled();
  });

  it('does nothing off Android or when the native module is missing', async () => {
    h.os = 'ios';
    await expect(setCalendarReminderJob(true)).resolves.toBeUndefined();
    expect(h.fcm!.scheduleCalendarReminderJob).not.toHaveBeenCalled();
    h.os = 'android';
    h.fcm = undefined;
    await expect(setCalendarReminderJob(true)).resolves.toBeUndefined();
  });

  it('an older build without the methods, or a rejecting bridge, never throws', async () => {
    h.fcm = {} as never;
    await expect(setCalendarReminderJob(true)).resolves.toBeUndefined();
    h.fcm = {
      scheduleCalendarReminderJob: vi.fn(async () => { throw new Error('boom'); }),
      cancelCalendarReminderJob: vi.fn(async () => { throw new Error('boom'); }),
    };
    await expect(setCalendarReminderJob(true)).resolves.toBeUndefined();
    await expect(setCalendarReminderJob(false)).resolves.toBeUndefined();
  });
});
