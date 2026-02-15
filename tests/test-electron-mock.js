// Mock electron module for standalone testing
module.exports = {
  app: {
    isPackaged: false,
    getPath: (name) => '/tmp',
    getAppPath: () => process.cwd(),
  },
};
