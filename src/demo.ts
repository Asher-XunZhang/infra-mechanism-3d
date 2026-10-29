import { mountSglangViewer } from './lib/sglang';
import type { MountedViewer } from './lib';
import './demo.css';

declare global {
  interface Window {
    demoViewer?: MountedViewer;
  }
}

const mountPoint = document.querySelector<HTMLElement>('[data-viewer-mount]');

function showMountError(message: string): void {
  if (!mountPoint) {
    return;
  }
  const panel = document.createElement('div');
  panel.className = 'mount-error';
  panel.setAttribute('role', 'alert');
  const title = document.createElement('strong');
  title.textContent = '三维阅读器没有完成装配';
  const copy = document.createElement('p');
  copy.textContent = message;
  const hint = document.createElement('p');
  hint.className = 'mount-error__hint';
  hint.textContent = '页面上的源码基线与三个场景概述仍可阅读；刷新页面会重新尝试。';
  panel.append(title, copy, hint);
  mountPoint.replaceChildren(panel);
  document.documentElement.classList.remove('has-viewer');
}

if (!mountPoint) {
  throw new Error('Demo page is missing [data-viewer-mount].');
}

mountPoint.replaceChildren();

try {
  const viewer = mountSglangViewer(mountPoint, { syncHash: true });
  window.demoViewer = viewer;
  mountPoint.dataset.ready = 'true';
  document.documentElement.classList.add('has-viewer');

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      viewer.destroy();
      if (window.demoViewer === viewer) {
        delete window.demoViewer;
      }
      document.documentElement.classList.remove('has-viewer');
    });
  }
} catch (error) {
  console.error('Unable to mount SGLang viewer', error);
  showMountError(
    error instanceof Error ? error.message : '挂载时出现未知错误。',
  );
}
