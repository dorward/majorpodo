import winston from 'winston';
import expressWinston from 'express-winston';

const transports = [
    new winston.transports.Console({
        level: 'debug',
        handleExceptions: true,
    }),
];

const format = winston.format.combine(winston.format.json());

const logger = winston.createLogger({
    transports,
    exitOnError: false,
});

export const log = (message: string) => {
    logger.log({
        level: 'info',
        message,
    });
};

export const error = (error: unknown) => {
    logger.log({
        level: 'error',
        message: `${error}`,
    });
};

export const requestLogger = expressWinston.logger({
    transports,
    format,
    meta: true, // optional: control whether you want to log the meta data about the request (default to true)
    msg: 'HTTP {{req.method}} {{req.url}}', // optional: customize the default logging message. E.g. "{{res.statusCode}} {{req.method}} {{res.responseTime}}ms {{req.url}}"
    expressFormat: true, // Use the default Express/morgan request formatting. Enabling this will override any msg if true. Will only output colors with colorize set to true
    colorize: false, // Color the text and status code, using the Express/morgan color palette (text: gray, status: default green, 3XX cyan, 4XX yellow, 5XX red).
    ignoreRoute: () => false, // optional: allows to skip some log messages based on request and/or response
});

export const errorLogger = expressWinston.errorLogger({
    transports,
    format,
});

export default logger;
