import { createSignal, onCleanup, onMount, type Accessor } from 'solid-js';

/** Tracks whether the document is currently visible to suspend background-only UI work. */
export function usePageVisible(): Accessor<boolean> {
  const [visible, setVisible] = createSignal(
    typeof document === 'undefined' ? true : document.visibilityState === 'visible'
  );

  onMount(() => {
    if (typeof document === 'undefined') return;
    const handleVisibilityChange = () => {
      setVisible(document.visibilityState === 'visible');
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    onCleanup(() => document.removeEventListener('visibilitychange', handleVisibilityChange));
  });

  return visible;
}
