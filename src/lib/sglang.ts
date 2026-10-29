import { mountViewer } from '../viewer/MechanismViewer';
import { sglangPack } from '../content/sglang';
import type { ViewerOptions, MountedViewer } from '../viewer/types';
export { sglangPack };
export type SglangViewerOptions = Omit<ViewerOptions, 'pack'>;
export function mountSglangViewer(container: HTMLElement, options: SglangViewerOptions = {}): MountedViewer {
  return mountViewer(container, { syncHash: false, ...options, pack: sglangPack });
}
