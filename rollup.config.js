export default {
  input: './dist/kernel.js',
  output: [{
    interop: false,
    file: './dist/kernel.bundle.cjs.js',
    format: 'cjs',
  }],
};