const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = env => {
    const isFirefox = env?.firefox;
    const isDev = process.env.NODE_ENV === 'development';

    return {
        entry: {
            content: './src/content.ts',
            background: './src/background.ts',
            popup: './src/popup.tsx'
        },
        module: {
            rules: [
                {
                    test: /\.tsx?$/,
                    use: 'ts-loader',
                    exclude: /node_modules/
                },
                {
                    test: /\.css$/,
                    use: ['style-loader', 'css-loader', 'postcss-loader']
                }
            ]
        },
        resolve: {
            extensions: ['.tsx', '.ts', '.js']
        },
        output: {
            filename: '[name].js',
            path: path.resolve(__dirname, isFirefox ? 'dist-firefox' : 'dist'),
            clean: true
        },
        plugins: [
            new CopyPlugin({
                patterns: [
                    {
                        from: isFirefox ? 'manifest-firefox.json' : 'manifest.json',
                        to: 'manifest.json'
                    },
                    { from: 'popup.html' }
                ]
            })
        ],
        devtool: isDev ? 'source-map' : false
    };
};
