module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
  verbose: true,
  maxWorkers: 4,
  forceExit: true,
  // detectOpenHandles: true,
};
