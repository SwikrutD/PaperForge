import { useAppStore } from './appStore';
import { useDocumentStore } from './documentStore';
import { useUiStore } from './uiStore';

/**
 * Starts presenting the active document from the page being read. The window
 * goes full screen unless it already is, and remembers to come back out when
 * the presentation ends.
 */
export async function startPresentation(): Promise<void> {
  if (useUiStore.getState().presentation !== null) return;
  const { tabs, activeId } = useDocumentStore.getState();
  const tab = tabs.find((candidate) => candidate.session.id === activeId);
  if (tab === undefined) return;
  const alreadyFullScreen = useAppStore.getState().windowState?.fullScreen ?? false;
  useUiStore.getState().setPresentation({
    pageNumber: tab.view.pageNumber,
    leaveFullScreen: !alreadyFullScreen,
  });
  if (!alreadyFullScreen) await useAppStore.getState().toggleFullScreen();
}

/**
 * Ends the presentation, however it was ended: the viewer comes back at the
 * page the presentation reached, and full screen is left if presenting
 * entered it.
 */
export async function stopPresentation(): Promise<void> {
  const presentation = useUiStore.getState().presentation;
  if (presentation === null) return;
  useUiStore.getState().setPresentation(null);
  const activeId = useDocumentStore.getState().activeId;
  if (activeId !== null) {
    useDocumentStore.getState().updateView(activeId, { pendingPage: presentation.pageNumber });
  }
  const fullScreen = useAppStore.getState().windowState?.fullScreen ?? false;
  if (presentation.leaveFullScreen && fullScreen) await useAppStore.getState().toggleFullScreen();
}
