import worker from './worker.mjs';

// The deployed module must only export Worker entrypoints, not test constants.
export default worker;
