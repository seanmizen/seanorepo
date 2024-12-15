// const ua = navigator.userAgent || navigator.vendor || window.opera;
// TODO, copilot,
// add opera to the window object / namespace

export {};

declare global {
  interface Window {
    opera: any;
  }
}
