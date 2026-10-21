/// <reference types="@rsbuild/core/types" />

declare module '*.module.css' {
  const classes: { [key: string]: string };
  export default classes;
}

declare module '*.css';

declare module '*.png' {
  const content: string;
  export default content;
}

declare module '*.jpg' {
  const content: string;
  export default content;
}
