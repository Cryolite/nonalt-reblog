const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

// Configuration reference: https://webpack.js.org/configuration/
module.exports = {
  // Disable optimization.
  mode: 'none',
  target: 'web',
  entry: {
    background: './src/background.js',
    index: './src/index.js',
    injection: './src/injection.js',
  },
  resolve: {
    extensions: ['.js', '.ts'],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: ['ts-loader'],
      },
    ],
  },
  plugins: [
    // Copy all files under static/ to dist/.
    new CopyPlugin({
      patterns: [{from: 'static', to: '.'}],
    }),
  ],
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
  },
  // Chrome extensions support inline source maps only.
  devtool: 'inline-cheap-module-source-map',
};
