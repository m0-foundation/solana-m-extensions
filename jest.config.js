module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
  verbose: true,
  maxWorkers: 1,
  forceExit: true,
  // detectOpenHandles: true,
};
