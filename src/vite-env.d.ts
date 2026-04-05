/// <reference types="vite/client" />

declare global {
  interface Window {
    electron: {
      invoke: (channel: string, ...args: any[]) => Promise<any>
    }
  }
}

export {}
