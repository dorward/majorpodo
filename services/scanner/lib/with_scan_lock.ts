import pool from './database/database';

// All scanner workers (including other scanner containers) share this session
// lock so cleanup cannot race with an import between artwork creation and INSERT.
const SCAN_LOCK = 1297108804;

const withScanLock = async <T>(work: () => Promise<T>): Promise<T> => {
    const client = await pool.connect();
    let locked = false;
    let discardConnection = false;
    let outcome: { ok: true; value: T } | { ok: false; error: unknown };
    try {
        await client.query('SELECT pg_advisory_lock($1)', [SCAN_LOCK]);
        locked = true;
        outcome = { ok: true, value: await work() };
    } catch (error) {
        if (!locked) discardConnection = true;
        outcome = { ok: false, error };
    }
    try {
        if (locked) await client.query('SELECT pg_advisory_unlock($1)', [SCAN_LOCK]);
    } catch (error) {
        // Never return a session with an uncertain lock state to the pool, and
        // preserve the original scan error if cleanup also fails.
        discardConnection = true;
        if (outcome.ok) outcome = { ok: false, error };
    } finally {
        client.release(discardConnection);
    }
    if (!outcome.ok) throw outcome.error;
    return outcome.value;
};

export default withScanLock;
