// Entry file for cPanel "Setup Node.js App" / Passenger / pm2.
process.env.XPOS_AUTOSTART = '1';
await import('./src/index.js');
