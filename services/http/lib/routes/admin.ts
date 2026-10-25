import { Router } from 'express';
import { selectDiscoveries } from '../database/select_discoveries';

// Exact, case-sensitive routes keep the URL boundary aligned with Nginx's admin location.
const admin = Router({ caseSensitive: true, strict: true });
admin.use(/^\/_admin(?=\/|$)/, (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
});
admin.get('/_admin', (_req, res) => res.redirect(308, '/_admin/'));
admin.get('/_admin/', (_req, res) => {
    res.render('admin/index.html', {
        pages: [{ url: '/_admin/discovery/', title: 'Media discovery' }],
    });
});
admin.get('/_admin/discovery', (_req, res) => res.redirect(308, '/_admin/discovery/'));
admin.get('/_admin/discovery/', async (req, res) => {
    const value = req.query.page ?? '1';
    if (typeof value !== 'string' || !/^[1-9]\d{0,5}$/.test(value)) {
        res.status(400).send('Invalid page');
        return;
    }
    const page = Number(value);
    try {
        const result = await selectDiscoveries(page);
        res.render('admin/discovery.html', {
            ...result,
            records: result.records.map((record) => ({
                ...record,
                discovered: record.discovered_at.toISOString(),
                processed: record.processed_at?.toISOString(),
            })),
            page,
            previous: page > 1 ? page - 1 : null,
            next: result.hasNext ? page + 1 : null,
        });
    } catch (error) {
        if ((error as { code?: string }).code === '42P01') {
            res.status(503).send(
                'Discovery tracking is not ready. Wait for the scanner to initialise its schema.',
            );
            return;
        }
        throw error;
    }
});
admin.all(/^\/_admin(?:\/|$)/, (_req, res) => res.sendStatus(404));
export default admin;
