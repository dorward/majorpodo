import { startScheduler } from './lib/start_scheduler';
import { error } from './lib/log';

startScheduler().catch((failure) => {
    error(failure);
    process.exitCode = 1;
});
