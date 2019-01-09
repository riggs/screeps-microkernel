export default {
  input: './dist/kernel.js',
  output: [{
    interop: false,
    file: './dist/kernel.cjs.js',
    format: 'cjs',
  }],
};