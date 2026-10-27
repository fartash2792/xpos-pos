module.exports = {
  apps: [{ name: 'xpos', cwd: __dirname + '/server', script: 'src/index.js', env: { NODE_ENV: 'production', PORT: 3000 } }]
};
