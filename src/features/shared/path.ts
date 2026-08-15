const toFileName = (path: string) => path.split(/[\\/]/).at(-1) || path;

export { toFileName };
