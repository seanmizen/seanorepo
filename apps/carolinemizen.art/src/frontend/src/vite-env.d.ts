/// <reference types="vite/client" />
declare module 'react-dom/client' {
  // typing module default export as `any` will allow you to access its members without compiler warning
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let createRoot: any;
  export { createRoot };
}
