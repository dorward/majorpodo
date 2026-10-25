import filters from './filters';
import type { AliasRule } from './types';

export const normaliseSeriesWithRules = (show?: string) => {
    const rules: AliasRule[] = [];
    let title = show || '__ Standalone Episode';
    if (show) {
        filters.remove.forEach((expression, index) => {
            const pattern = new RegExp(expression);
            if (!pattern.test(title)) return;
            const before = title;
            title = title.replace(pattern, '');
            rules.push({ kind: 'remove', rule: index + 1, expression, before, after: title });
        });
        filters.replace.forEach((filter, index) => {
            if (!new RegExp(filter.expression).test(title)) return;
            const before = title;
            title = filter.title;
            rules.push({
                kind: 'replace',
                rule: index + 1,
                expression: filter.expression,
                before,
                after: title,
            });
        });
    }
    return { title, rules };
};
