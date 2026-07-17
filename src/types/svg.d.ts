// SVG 资源的环境模块声明：esbuild 通过 loader 把 .svg 导入处理成字符串 URL，
// tsc 需要对应的模块声明才能识别 `import x from '*.svg'` 默认导出。
// 本文件不含任何顶层 import/export，确保被当作全局环境声明（而非模块增强）。
declare module '*.svg' {
  const content: string;
  export default content;
}
