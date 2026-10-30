import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { LaneDefinition, ModuleDoc, SceneReadout, ViewerStep } from '../types';
import { FallbackStage } from './FallbackStage';
import { ReadoutPanel } from './Readout';

const lane: LaneDefinition = {
  id: 'main',
  label: '普通生成基线',
  version: 'main 基线',
  commit: 'a'.repeat(40),
  shortCommit: 'a'.repeat(10),
  status: '固定源码基线',
  note: '普通单卡部署。',
  available: true,
  accent: 'cyan',
};

const step: ViewerStep = {
  id: 'step-1',
  label: '请求进入',
  title: '<script>alert(1)</script>',
  summary: '文本摘要 <b>不应成为 HTML</b>。',
  points: ['输入经过入口进程', '<img src=x onerror=alert(1)>'],
  moduleIds: ['api'],
};

const module: ModuleDoc = {
  id: 'api',
  title: 'HTTP 入口',
  name: 'http_server',
  directory: 'srt',
  groupId: 'entry',
  accent: 'cyan',
  summary: '接住请求。',
  why: '边界从入口开始。',
  action: '解析并转发。',
  objects: ['请求'],
  boundaries: ['不是调度器'],
  sourceIds: [],
};

describe('React fallback and readout UI', () => {
  it('renders a text fallback with escaped content and module chips', () => {
    const markup = renderToStaticMarkup(
      <FallbackStage
        step={step}
        lane={lane}
        modules={[module]}
        reason="此浏览器没有 WebGL。"
        eyebrow="NO WEBGL · 文本阅读"
        onSelectModule={() => {}}
      />,
    );
    expect(markup).toContain('NO WEBGL · 文本阅读');
    expect(markup).toContain('普通生成基线');
    expect(markup).toContain('HTTP 入口');
    expect(markup).toContain('此浏览器没有 WebGL。');
    expect(markup).toContain('&lt;script&gt;');
    expect(markup).not.toContain('<script>');
    expect(markup).not.toContain('<img');
  });

  it('renders stats, groups and tone data from a scene readout', () => {
    const readout: SceneReadout = {
      eyebrow: 'R1 · Decode',
      title: 'KV 槽位',
      detail: '槽位是教学读数，不是容量实测。',
      stats: [{ label: '已占用', value: '3 / 8', tone: 'active' }],
      groups: [
        {
          id: 'requests',
          title: '请求',
          note: '当前采样',
          rows: [
            {
              id: 'r1',
              label: 'R1 · Decode',
              meta: '输入 4',
              detail: 'KV #1 #2',
              tone: 'warning',
            },
          ],
        },
      ],
    };
    const markup = renderToStaticMarkup(<ReadoutPanel readout={readout} />);
    expect(markup).toContain('SCENE READOUT');
    expect(markup).toContain('KV 槽位');
    expect(markup).toContain('3 / 8');
    expect(markup).toContain('data-tone="active"');
    expect(markup).toContain('data-tone="warning"');
    expect(markup).toContain('R1 · Decode');
  });
});
