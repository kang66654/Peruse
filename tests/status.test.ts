import { describe, expect, it } from 'vitest';
import { getDigestStatus, setDigestStatus, watchDigestStatus } from '../src/utils/status';

describe('生成状态', () => {
  it('未写入时返回 idle', async () => {
    expect(await getDigestStatus()).toEqual({ state: 'idle', message: '', at: 0 });
  });

  it('写入后可读取，at 自动补时间戳', async () => {
    const before = Date.now();
    await setDigestStatus({ state: 'running', message: '正在排序…' });
    const status = await getDigestStatus();
    expect(status.state).toBe('running');
    expect(status.message).toBe('正在排序…');
    expect(status.at).toBeGreaterThanOrEqual(before);

    await setDigestStatus({ state: 'done', message: '完成', pickCount: 3, fallback: false });
    expect((await getDigestStatus()).pickCount).toBe(3);
  });

  it('watchDigestStatus 收到变化，取消后不再收到', async () => {
    const states: string[] = [];
    const stop = watchDigestStatus((status) => states.push(status.state));

    await setDigestStatus({ state: 'running', message: '' });
    expect(states).toContain('running');

    stop();
    await setDigestStatus({ state: 'done', message: '' });
    expect(states).not.toContain('done');
  });
});
