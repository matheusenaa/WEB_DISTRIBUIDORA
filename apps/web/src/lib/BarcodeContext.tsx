import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';

export type BarcodeAction = 
  | 'PRODUCT_CREATE'
  | 'PRODUCT_SEARCH'
  | 'PRODUCT_LOOKUP'
  | 'PDV_ADD'
  | 'STOCK_LOOKUP'
  | 'MOVEMENT_LOOKUP'
  | 'TEST';

export interface BarcodeScanEvent {
  code: string;
  timestamp: number;
  action: BarcodeAction;
  target?: string;
}

interface BarcodeContextValue {
  lastScan: BarcodeScanEvent | null;
  registerListener: (action: BarcodeAction, callback: (code: string) => void, target?: string) => () => void;
  unregisterListener: (action: BarcodeAction, target?: string) => void;
  simulateScan: (code: string, action: BarcodeAction) => void;
}

const BarcodeContext = createContext<BarcodeContextValue | null>(null);

const listeners = new Map<string, Map<string, (code: string) => void>>();

function getListenerKey(action: BarcodeAction, target?: string): string {
  return `${action}:${target ?? 'default'}`;
}

export function BarcodeProvider({ children }: { children: ReactNode }) {
  const [lastScan, setLastScan] = useState<BarcodeScanEvent | null>(null);

  const registerListener = (action: BarcodeAction, callback: (code: string) => void, target?: string) => {
    getListenerKey(action, target);
    if (!listeners.has(action)) {
      listeners.set(action, new Map());
    }
    listeners.get(action)!.set(target ?? 'default', callback);

    return () => {
      listeners.get(action)?.delete(target ?? 'default');
    };
  };

  const unregisterListener = (action: BarcodeAction, target?: string) => {
    listeners.get(action)?.delete(target ?? 'default');
  };

  const simulateScan = (code: string, action: BarcodeAction) => {
    const event: BarcodeScanEvent = {
      code,
      timestamp: Date.now(),
      action,
    };
    setLastScan(event);

    const actionListeners = listeners.get(action);
    if (actionListeners) {
      actionListeners.forEach((callback) => callback(code));
    }
  };

  const handleGlobalScan = (code: string) => {
    const event: BarcodeScanEvent = {
      code,
      timestamp: Date.now(),
      action: 'TEST',
    };
    setLastScan(event);

    listeners.forEach((actionListeners) => {
      actionListeners.forEach((callback) => callback(code));
    });
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.altKey || event.metaKey) return;

      const target = event.target as HTMLElement | null;
      const isEditable =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true;

      if (isEditable) return;

      if (event.key === 'Enter') {
        const code = (window as any).__barcodeBuffer ?? '';
        if (code.length >= 4) {
          event.preventDefault();
          (window as any).__barcodeBuffer = '';
          handleGlobalScan(code);
        }
        return;
      }

      if (event.key.length === 1) {
        (window as any).__barcodeBuffer = ((window as any).__barcodeBuffer ?? '') + event.key;
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, []);

  return (
    <BarcodeContext.Provider value={{ lastScan, registerListener, unregisterListener, simulateScan }}>
      {children}
    </BarcodeContext.Provider>
  );
}

export function useBarcode() {
  const context = useContext(BarcodeContext);
  if (!context) {
    throw new Error('useBarcode must be used within a BarcodeProvider');
  }
  return context;
}

export function useBarcodeListener(
  action: BarcodeAction,
  callback: (code: string) => void,
  target?: string,
  enabled = true
) {
  const { registerListener, unregisterListener } = useBarcode();
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!enabled) return;
    const cleanup = registerListener(action, (code) => callbackRef.current(code), target);
    return cleanup;
  }, [action, target, enabled, registerListener]);

  useEffect(() => {
    return () => unregisterListener(action, target);
  }, [action, target, unregisterListener]);
}