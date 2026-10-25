import winston from 'winston';

const transports = [
    new winston.transports.Console({
        level: 'debug',
        handleExceptions: true,
    }),
];

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

export default logger;
