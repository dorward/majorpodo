import scan from '../lib/scan_for_deleted';
import { error } from '../lib/log';
import { runScan } from '../lib/run_scan';

runScan(scan).catch((failure) => {
    error(failure);
    process.exitCode = 1;
});
