import { Component, For, Show, createSignal, onCleanup } from 'solid-js';

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  // Recording controls
  isRecording: boolean;
  onToggleRecording: () => void;
  // Model state
  isModelReady: boolean;
  onLoadModel: () => void;
  modelState: string;
  // Device selection
  availableDevices: MediaDeviceInfo[];
  selectedDeviceId: string;
  onDeviceSelect: (id: string) => void;
  // Audio feedback
  audioLevel: number;
}

export const Sidebar: Component<SidebarProps> = (props) => {
  const [showDevices, setShowDevices] = createSignal(false);

  return (
    <div class="flex flex-col h-full gap-4">
      <nav class="w-20 flex-1 nm-flat rounded-2xl flex flex-col items-center py-4 gap-3 z-20 transition-all duration-300">
        {/* Power Button - Reflects System Readiness */}
        <div class="relative mb-2">
          <button
            onClick={() => props.onLoadModel()}
            class="w-14 h-14 rounded-full nm-button flex items-center justify-center group active:scale-95 transition-all"
          >
            <span class={`material-icons-round text-2xl transition-all ${props.isModelReady ? 'text-slate-800 dark:text-slate-200' : 'text-slate-400'}`}>power_settings_new</span>
            {/* LED indicator */}
            <div class={`absolute bottom-3 right-3 led-dot ${props.isModelReady ? 'led-green-active' : 'led-green-passive'}`}></div>
          </button>
        </div>

        {/* Record Button - High Prominence Mechanical Style */}
        <div class="relative group mb-2">
          <button
            onClick={() => props.onToggleRecording()}
            class={`w-14 h-14 rounded-full flex flex-col items-center justify-center transition-all duration-300 active:scale-95 ${props.isRecording
              ? 'nm-inset text-[var(--primary)]'
              : props.isModelReady
                ? 'nm-button text-slate-700 dark:text-slate-200'
                : 'nm-button text-gray-400 opacity-50'
              }`}
            title={props.isRecording ? "Stop Recording" : "Start Recording"}
          >
            <span class="material-icons-round text-2xl mb-0.5">{props.isRecording ? 'pause' : 'mic'}</span>
            {/* Mechanical LED dot for Status */}
            <div class={`led-dot ${props.isRecording ? 'led-red-active' : 'led-red-passive'}`}></div>
          </button>
        </div>

        <div class="w-10 h-[2px] nm-inset rounded-full opacity-10 my-2"></div>

        {/* Navigation Items */}
        <div class="flex flex-col gap-4 w-full items-center">
          {/* Device Selection Popover Trigger */}
          <div class="relative">
            <button
              class={`group relative w-12 h-12 flex items-center justify-center rounded-2xl transition-all ${showDevices() ? 'nm-inset text-[var(--accent-blue)]' : 'nm-button text-slate-400 dark:text-slate-500'
                }`}
              onClick={() => setShowDevices(!showDevices())}
            >
              <span class="material-icons-round text-xl">settings_input_composite</span>
            </button>

            {/* Device Selection Popover */}
            <Show when={showDevices()}>
              <div class="absolute left-full bottom-0 ml-6 w-64 nm-flat rounded-[32px] p-4 z-50 animate-in fade-in slide-in-from-left-2 duration-200">
                <div class="text-[9px] font-black text-slate-400 p-2 uppercase tracking-widest mb-2 border-b border-slate-200 dark:border-slate-700">Mechanical_Input</div>
                <div class="flex flex-col gap-1 max-h-64 overflow-y-auto pr-1">
                  <For each={props.availableDevices}>
                    {(device) => (
                      <button
                        class={`w-full text-left px-4 py-3 rounded-2xl text-xs transition-all flex items-center gap-3 ${props.selectedDeviceId === device.deviceId
                          ? 'nm-inset text-[var(--accent-blue)] font-bold'
                          : 'text-slate-600 dark:text-slate-400 hover:nm-button'
                          }`}
                        onClick={() => {
                          props.onDeviceSelect(device.deviceId);
                          setShowDevices(false);
                        }}
                      >
                        <span class="material-icons-round text-lg opacity-40">keyboard_voice</span>
                        <span class="truncate font-medium">{device.label || `Channel ${device.deviceId.slice(0, 4)}`}</span>
                      </button>
                    )}
                  </For>
                </div>
              </div>
            </Show>
          </div>

          <button
            class={`group relative w-12 h-12 flex items-center justify-center rounded-2xl transition-all ${props.activeTab === 'transcript' ? 'nm-inset text-[var(--accent-blue)]' : 'nm-button text-slate-400 dark:text-slate-500'
              }`}
            onClick={() => props.onTabChange('transcript')}
          >
            <span class="material-icons-round text-xl">text_fields</span>
          </button>

          <button
            class={`group relative w-12 h-12 flex items-center justify-center rounded-2xl transition-all ${props.activeTab === 'translate' ? 'nm-inset text-[var(--accent-blue)]' : 'nm-button text-slate-400 dark:text-slate-500'
              }`}
            onClick={() => props.onTabChange('translate')}
          >
            <span class="material-icons-round text-xl">translate</span>
          </button>
        </div>

        <div class="mt-auto flex flex-col gap-4">
          <button
            class={`group relative w-12 h-12 flex items-center justify-center rounded-2xl transition-all ${props.activeTab === 'ai' ? 'nm-inset text-[var(--accent-blue)]' : 'nm-button text-slate-400 dark:text-slate-500'
              }`}
            onClick={() => props.onTabChange('ai')}
          >
            <span class="material-icons-round text-xl">psychology</span>
          </button>
        </div>
      </nav>
    </div>
  );
};

export default Sidebar;

