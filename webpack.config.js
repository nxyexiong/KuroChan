const path = require('path');

module.exports = {
  mode: 'development',
  devtool: 'inline-source-map',
  entry: './src/renderer/index.js',
  output: {
    filename: 'bundle.js',
    path: path.resolve(__dirname, 'dist'),
  },
  target: 'web',
  module: {
    rules: [
      {
        test: /\.css$/i,
        use: ['style-loader', 'css-loader'],
      },
    ],
  },
  resolve: {
    extensions: ['.js'],
    fallback: { path: false, fs: false },
  },
};
