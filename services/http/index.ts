import { startServer } from './lib/start_server';

startServer().catch((error) => {
    console.error('HTTP server startup failed:', error);
    process.exitCode = 1;
});

process.on('exit', (code) => {
    console.log('HTTP server quit with code : ', code);
});
